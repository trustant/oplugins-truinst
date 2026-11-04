// Copyright 2025-2026 Nuvolaris Inc
// SPDX-License-Identifier: AGPL-3.0-or-later
// This program is free software under the GNU Affero General Public License as published
// by the Free Software Foundation, version 3 or later. See ../LICENSE.
import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  cpSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  Addon,
  imageRef,
  labels,
  manifest,
  namespace,
  owner,
  ownerLabel,
  parseOptions,
  stateDir,
  type Resource,
  type Run,
} from "./core";

const image = imageRef("arm64");
const owned = (name: string): Resource => ({
  metadata: { name, namespace, labels },
});
const nodes = {
  items: [
    {
      metadata: { name: "vm" },
      status: {
        nodeInfo: { architecture: "arm64" },
        conditions: [
          { type: "Ready", status: "True" },
          { type: "DiskPressure", status: "False" },
        ],
      },
    },
  ],
};
class Fake {
  calls: { args: string[]; input?: string }[] = [];
  objects = new Map<string, Resource>();
  images = [image];
  otherPods: Resource[] = [];
  localState = false;
  symlink = false;
  marker = owner;
  nodeData = structuredClone(nodes);
  fail: (args: string[]) => boolean = () => false;
  run: Run = async (args, input) => {
    this.calls.push({ args, input });
    const text = args.join(" ");
    if (this.fail(args))
      return { code: 17, stdout: "", stderr: "deliberate failure" };
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    if (args.includes("get") && args.includes("nodes"))
      return ok(JSON.stringify(this.nodeData));
    if (args.includes("get") && args.includes("pods") && args.includes("-A"))
      return ok(JSON.stringify({ items: this.otherPods }));
    if (args.includes("get")) {
      const i = args.indexOf("get");
      return ok(
        this.objects.has(args[i + 1]!)
          ? JSON.stringify(this.objects.get(args[i + 1]!))
          : "",
      );
    }
    if (text.includes("ctr images ls")) return ok(this.images.join("\n"));
    if (text.includes(`test -L ${stateDir}`))
      return { ...ok(), code: this.symlink ? 0 : 1 };
    if (text.includes(`test -e ${stateDir}`))
      return { ...ok(), code: this.localState ? 0 : 1 };
    if (text.includes(`cat ${stateDir}/owner`)) return ok(this.marker);
    if (text.includes("systemctl is-active")) return { ...ok(), code: 3 };
    if (text.includes("which ")) return ok(`/usr/local/bin/${args.at(-1)}\n`);
    if (args.includes("exec")) return ok('{"ok":true}');
    return ok();
  };
  addon() {
    return new Addon(this.run, "arm64", true, import.meta.dir, false);
  }
  installed() {
    this.objects.set("namespace", owned(namespace));
    this.objects.set("statefulset", {
      ...owned("infinity"),
      status: { readyReplicas: 1 },
    });
    this.objects.set("service", owned("infinity"));
    this.objects.set("pvc", {
      ...owned("model-cache-infinity-0"),
      status: { phase: "Bound" },
    });
    this.objects.set("configmap", {
      ...owned("infinity-addon"),
      data: { images: JSON.stringify([image]) },
    });
    return this;
  }
  writes() {
    return this.calls.filter((c) =>
      c.args.some((a) =>
        [
          "apply",
          "delete",
          "mkdir",
          "tee",
          "rm",
          "systemd-run",
          "import",
        ].includes(a),
      ),
    );
  }
}
const options = (
  command: "install" | "status" | "test" | "logs" | "uninstall",
  purge = false,
  dryRun = false,
) => ({ command, purge, dryRun });

describe("CLI boundaries", () => {
  test("accepts OPS booleans and explicit direct flags without coercing false to true", () => {
    expect(parseOptions(["uninstall", "false", "true"])).toEqual(
      options("uninstall", false, true),
    );
    expect(parseOptions(["uninstall", "--purge"])).toEqual(
      options("uninstall", true),
    );
    expect(parseOptions(["install", "false"])).toEqual(options("install"));
    expect(() => parseOptions(["status", "--purge"])).toThrow();
    expect(() => parseOptions(["uninstall", "--purge", "--purge"])).toThrow();
    expect(() => parseOptions(["install", "true", "false"])).toThrow();
  });
  test("dry-run is read-only even outside Linux", async () => {
    const fake = new Fake();
    const addon = new Addon(fake.run, "arm64", false);
    expect(await addon.execute(options("install", false, true))).toHaveProperty(
      "action",
      "install",
    );
    expect(
      await addon.execute(options("uninstall", true, true)),
    ).toHaveProperty("deleteModelCache", true);
    expect(fake.calls).toHaveLength(0);
  });
  test("status cannot select an ambient remote kubeconfig or mutate state", async () => {
    const fake = new Fake();
    await fake.addon().execute(options("status"));
    expect(fake.writes()).toHaveLength(0);
    const args = fake.calls[0]!.args;
    expect(args.slice(0, 4)).toEqual(["sudo", "-n", "k3s", "kubectl"]);
    expect(args).toContain("--kubeconfig=/etc/rancher/k3s/k3s.yaml");
  });
  test("rejects unexpected node architecture before mutation", async () => {
    const fake = new Fake();
    fake.nodeData.items[0]!.status.nodeInfo.architecture = "amd64";
    await expect(fake.addon().execute(options("install"))).rejects.toThrow(
      "native CPU",
    );
    expect(fake.writes()).toHaveLength(0);
  });
  test("DiskPressure blocks installation but keeps removal available", async () => {
    const fake = new Fake().installed();
    fake.nodeData.items[0]!.status.conditions[1]!.status = "True";
    await expect(fake.addon().execute(options("install"))).rejects.toThrow(
      "DiskPressure",
    );
    expect(fake.writes()).toHaveLength(0);
    await fake.addon().execute(options("uninstall"));
    expect(fake.writes()).toHaveLength(2);
  });
});

describe("owned lifecycle", () => {
  test("foreign namespace and PVC block installation before image building", async () => {
    for (const kind of ["namespace", "pvc"]) {
      const fake = new Fake().installed();
      fake.objects.set(kind, { metadata: { name: "foreign" } });
      await expect(fake.addon().execute(options("install"))).rejects.toThrow(
        "unowned",
      );
      expect(fake.writes()).toHaveLength(0);
    }
  });
  test("cached image install uses the retained PVC and performs real inference", async () => {
    const fake = new Fake().installed();
    const result = await fake.addon().execute(options("install"));
    expect(result).toHaveProperty("verification.ok", true);
    expect(fake.calls.some((c) => c.args.includes("systemd-run"))).toBe(false);
    const apply = fake.calls.find((c) => c.args.includes("apply"))!;
    expect(apply.input).not.toContain("OFFLINE");
    expect(
      fake.calls.some(
        (c) => c.args.includes("exec") && c.input?.includes("/embeddings"),
      ),
    ).toBe(true);
  });
  test("build failure stops installation and stops only the dedicated builder", async () => {
    const fake = new Fake();
    fake.images = [];
    fake.fail = (args) => args.includes("buildctl") && args.includes("build");
    await expect(fake.addon().execute(options("install"))).rejects.toThrow(
      "deliberate failure",
    );
    expect(fake.calls.some((c) => c.args.includes("apply"))).toBe(false);
    expect(
      fake.calls.some((c) =>
        c.args.join(" ").endsWith("systemctl stop trustant-infinity-builder"),
      ),
    ).toBe(true);
  });
  test("apply and inference failures never become install success", async () => {
    for (const failed of ["apply", "exec"]) {
      const fake = new Fake().installed();
      fake.fail = (args) => args.includes(failed);
      await expect(fake.addon().execute(options("install"))).rejects.toThrow(
        "deliberate failure",
      );
    }
  });
  test("default uninstall retains the model, image and build cache", async () => {
    const fake = new Fake().installed();
    expect(await fake.addon().execute(options("uninstall"))).toHaveProperty(
      "cachePreserved",
      true,
    );
    const writes = fake.writes().map((c) => c.args.join(" "));
    expect(writes).toHaveLength(2);
    expect(
      writes.every(
        (s) =>
          s.includes(`-n ${namespace} delete`) &&
          !s.includes("pvc") &&
          !s.includes("configmap"),
      ),
    ).toBe(true);
    expect(fake.calls.some((c) => c.args.includes("ctr"))).toBe(false);
  });
  test("repeated uninstall without an installation is a no-op", async () => {
    const fake = new Fake();
    await fake.addon().execute(options("uninstall"));
    await fake.addon().execute(options("uninstall"));
    expect(fake.writes()).toHaveLength(0);
  });
  test("purge deletes only named owned state, never an entire namespace or shared images", async () => {
    const fake = new Fake().installed();
    fake.localState = true;
    await fake.addon().execute(options("uninstall", true));
    const writes = fake.writes().map((c) => c.args.join(" "));
    expect(
      writes.some((s) => s.includes("delete pvc model-cache-infinity-0")),
    ).toBe(true);
    expect(writes.some((s) => s.endsWith(`ctr images rm ${image}`))).toBe(true);
    expect(writes.some((s) => s.endsWith(`rm -rf -- ${stateDir}`))).toBe(true);
    expect(writes.some((s) => /delete namespace|prune|--all/.test(s))).toBe(
      false,
    );
  });
  test("purge retains image references used by another workload's init container", async () => {
    const fake = new Fake().installed();
    fake.otherPods = [
      {
        metadata: { name: "other", namespace: "other-app" },
        spec: { initContainers: [{ image }] },
      },
    ];
    expect(
      await fake.addon().execute(options("uninstall", true)),
    ).toHaveProperty("retainedImages", [image]);
    expect(
      fake.calls.some((c) => c.args.includes("ctr") && c.args.includes("rm")),
    ).toBe(false);
    expect(
      fake.calls.some(
        (c) => c.args.includes("delete") && c.args.includes("configmap"),
      ),
    ).toBe(false);
  });
  test("purge recovers the image from a first apply failure without touching the trial", async () => {
    const fake = new Fake();
    await fake.addon().execute(options("uninstall", true));
    expect(
      fake.calls.some((c) =>
        c.args.join(" ").endsWith(`ctr images rm ${image}`),
      ),
    ).toBe(true);
    expect(
      fake.calls.some((c) => c.args.some((a) => a.includes("infinity-trial"))),
    ).toBe(false);
  });
  test("purge retains images used by additional pods even in the add-on namespace", async () => {
    const fake = new Fake().installed();
    fake.otherPods = [
      {
        metadata: { name: "inspection", namespace },
        spec: { containers: [{ image }] },
      },
    ];
    expect(
      await fake.addon().execute(options("uninstall", true)),
    ).toHaveProperty("retainedImages", [image]);
  });
  test("untrusted inventory, local marker and symlink fail before deletion", async () => {
    for (const problem of ["inventory", "marker", "symlink"]) {
      const fake = new Fake().installed();
      if (problem === "inventory")
        fake.objects.get("configmap")!.data!.images =
          '["unrelated/product:latest"]';
      if (problem === "marker") {
        fake.localState = true;
        fake.marker = "other-app";
      }
      if (problem === "symlink") fake.symlink = true;
      await expect(
        fake.addon().execute(options("uninstall", true)),
      ).rejects.toThrow();
      expect(fake.writes()).toHaveLength(0);
    }
  });
});

describe("CPU packaging and isolation", () => {
  test("fresh manifest permits initial download, retains claims, and avoids GPU/public exposure", () => {
    const output = manifest(image);
    const sts = output.items.find((o) => o.kind === "StatefulSet")!;
    const data = JSON.parse(JSON.stringify(sts));
    const pod = data.spec.template.spec;
    expect(pod.enableServiceLinks).toBe(false);
    expect(pod.securityContext.runAsUser).toBe(10001);
    expect(pod.containers[0].args).toContain("cpu");
    expect(pod.containers[0].resources.limits).toEqual({
      cpu: "2",
      memory: "3Gi",
    });
    expect(
      pod.containers[0].env.some((e: { name: string }) =>
        e.name.includes("OFFLINE"),
      ),
    ).toBe(false);
    expect(data.spec.persistentVolumeClaimRetentionPolicy).toEqual({
      whenDeleted: "Retain",
      whenScaled: "Retain",
    });
    expect(data.spec.volumeClaimTemplates[0].metadata.labels[ownerLabel]).toBe(
      owner,
    );
    expect(JSON.stringify(output)).not.toMatch(
      /nvidia|cuda|NodePort|hostPort|Ingress/,
    );
  });
  test("image identity changes with the selected dependency lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "infinity-source-"));
    try {
      cpSync(join(import.meta.dir, "image"), join(dir, "image"), {
        recursive: true,
      });
      const before = imageRef("arm64", dir);
      appendFileSync(
        join(dir, "image", "requirements-arm64.txt"),
        "\n# changed dependency lock\n",
      );
      expect(imageRef("arm64", dir)).not.toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("both platform locks pin CPU torch and exclude NVIDIA packages", () => {
    for (const arch of ["arm64", "amd64"]) {
      const lock = readFileSync(
        join(import.meta.dir, "image", `requirements-${arch}.txt`),
        "utf8",
      );
      expect(lock).toContain("torch==2.8.0+cpu");
      expect(lock).toContain("pyarrow==19.0.1");
      expect(lock).not.toMatch(/^nvidia-/m);
      expect(lock).toContain("--hash=sha256:");
    }
  });
  test("ordinary Trustant deployment and image configuration are unchanged", () => {
    for (const file of ["trustant/opsfile.yml", "opsroot.json"]) {
      const root = join(import.meta.dir, "..");
      const before = execFileSync("git", ["show", `HEAD:${file}`], {
        cwd: root,
        encoding: "utf8",
      });
      expect(readFileSync(join(root, file), "utf8")).toBe(before);
    }
  });
});
