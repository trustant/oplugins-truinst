// Copyright 2025-2026 Nuvolaris Inc
// SPDX-License-Identifier: AGPL-3.0-or-later
// This program is free software under the GNU Affero General Public License as published
// by the Free Software Foundation, version 3 or later. See ../LICENSE.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const namespace = "trustant-infinity";
export const owner = "trustant-infinity-addon";
export const stateDir = "/var/lib/trustant-infinity-addon";
export const ownerLabel = "app.kubernetes.io/managed-by";
export const model = "intfloat/multilingual-e5-small";
export const revision = "614241f622f53c4eeff9890bdc4f31cfecc418b3";
export const imageRepository = "localhost/trustant-infinity-cpu";
export const labels = {
  [ownerLabel]: owner,
  "app.kubernetes.io/name": "infinity",
};
const builderUnit = "trustant-infinity-builder";
const builderAddress = `unix:///run/${builderUnit}/buildkitd.sock`;
export type Architecture = "arm64" | "amd64";
export type Command = "install" | "status" | "test" | "logs" | "uninstall";
export interface Options {
  command: Command;
  dryRun: boolean;
  purge: boolean;
}
export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}
export type Run = (
  args: string[],
  input?: string,
  live?: boolean,
  timeoutMs?: number,
) => Promise<Result>;
interface Metadata {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
}
export interface Resource {
  metadata: Metadata;
  data?: Record<string, string>;
  spec?: {
    containers?: { image: string }[];
    initContainers?: { image: string }[];
    ephemeralContainers?: { image: string }[];
    template?: { spec?: { containers?: { image: string }[] } };
  };
  status?: {
    readyReplicas?: number;
    phase?: string;
    nodeInfo?: { architecture: string };
    conditions?: { type: string; status: string }[];
  };
}

export function parseOptions(args: string[]): Options | null {
  if (args.length === 0 || ["help", "--help", "-h"].includes(args[0]!)) {
    if (args.length > 1) throw new Error("Help does not accept arguments.");
    return null;
  }
  const [command, ...flags] = args;
  if (!["install", "status", "test", "logs", "uninstall"].includes(command!))
    throw new Error(`Unknown command: ${command}`);
  // OPS passes docopts boolean values as positional arguments; direct Bun use
  // also accepts flags so dry-run/help remain useful outside the OPS dispatcher.
  let purge = false,
    dryRun = false;
  if (flags.some((f) => f === "true" || f === "false")) {
    const expected =
      command === "uninstall" ? 2 : command === "install" ? 1 : 0;
    if (
      flags.length !== expected ||
      flags.some((f) => !["true", "false"].includes(f))
    )
      throw new Error("Invalid task boolean arguments.");
    if (command === "uninstall")
      [purge, dryRun] = flags.map((f) => f === "true") as [boolean, boolean];
    else dryRun = flags[0] === "true";
  } else {
    const allowed =
      command === "uninstall"
        ? ["--purge", "--dry-run"]
        : command === "install"
          ? ["--dry-run"]
          : [];
    if (
      flags.some((f) => !allowed.includes(f)) ||
      new Set(flags).size !== flags.length
    )
      throw new Error("Invalid or duplicate option.");
    purge = flags.includes("--purge");
    dryRun = flags.includes("--dry-run");
  }
  return { command: command as Command, dryRun, purge };
}

export function imageRef(
  arch: Architecture,
  sourceDir = import.meta.dir,
): string {
  const hash = createHash("sha256");
  for (const file of ["Dockerfile", "start.py", `requirements-${arch}.txt`])
    hash.update(readFileSync(join(sourceDir, "image", file)));
  return `${imageRepository}:0.0.78-${arch}-${hash.digest("hex").slice(0, 12)}`;
}

export function assertOwned(
  resource: Resource | null,
  description: string,
): void {
  if (resource && resource.metadata.labels?.[ownerLabel] !== owner)
    throw new Error(`Refusing unowned ${description}; no changes made.`);
}

export function validateImages(images: unknown): string[] {
  if (
    !Array.isArray(images) ||
    images.some(
      (i) =>
        typeof i !== "string" ||
        !/^localhost\/trustant-infinity-cpu:0\.0\.78-(arm64|amd64)-[a-f0-9]{12}$/.test(
          i,
        ),
    )
  ) {
    throw new Error("Invalid image inventory; refusing image deletion.");
  }
  return [...new Set(images)] as string[];
}

export function manifest(image: string, inventory = [image]) {
  const metadata = (name: string) => ({ name, namespace, labels });
  const probe = { httpGet: { path: "/health", port: "http" } };
  return {
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: namespace, labels },
      },
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: metadata("infinity-addon"),
        data: { images: JSON.stringify(inventory) },
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: metadata("infinity"),
        spec: {
          type: "ClusterIP",
          selector: labels,
          ports: [{ name: "http", port: 7997, targetPort: "http" }],
        },
      },
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: metadata("infinity"),
        spec: {
          serviceName: "infinity",
          replicas: 1,
          selector: { matchLabels: labels },
          persistentVolumeClaimRetentionPolicy: {
            whenDeleted: "Retain",
            whenScaled: "Retain",
          },
          template: {
            metadata: { labels },
            spec: {
              // Service links would otherwise inject INFINITY_PORT=tcp://..., which
              // Infinity parses before it applies the numeric CLI --port argument.
              enableServiceLinks: false,
              automountServiceAccountToken: false,
              securityContext: {
                runAsUser: 10001,
                runAsGroup: 10001,
                fsGroup: 10001,
              },
              containers: [
                {
                  name: "infinity",
                  image,
                  imagePullPolicy: "Never",
                  args: [
                    "v2",
                    "--model-id",
                    model,
                    "--revision",
                    revision,
                    "--served-model-name",
                    "embeddings",
                    "--engine",
                    "torch",
                    "--device",
                    "cpu",
                    "--dtype",
                    "float32",
                    "--batch-size",
                    "4",
                    "--host",
                    "0.0.0.0",
                    "--port",
                    "7997",
                  ],
                  env: [
                    { name: "INFINITY_TRUST_REMOTE_CODE", value: "false" },
                    { name: "INFINITY_BETTERTRANSFORMER", value: "false" },
                  ],
                  ports: [{ name: "http", containerPort: 7997 }],
                  startupProbe: {
                    ...probe,
                    periodSeconds: 5,
                    failureThreshold: 180,
                  },
                  readinessProbe: { ...probe, periodSeconds: 5 },
                  livenessProbe: {
                    ...probe,
                    periodSeconds: 20,
                    failureThreshold: 3,
                  },
                  resources: {
                    requests: { cpu: "500m", memory: "1Gi" },
                    limits: { cpu: "2", memory: "3Gi" },
                  },
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    capabilities: { drop: ["ALL"] },
                  },
                  volumeMounts: [{ name: "model-cache", mountPath: "/cache" }],
                },
              ],
            },
          },
          volumeClaimTemplates: [
            {
              metadata: { name: "model-cache", labels },
              spec: {
                accessModes: ["ReadWriteOnce"],
                resources: { requests: { storage: "5Gi" } },
              },
            },
          ],
        },
      },
    ],
  };
}

export class Addon {
  private privileged: string[];
  constructor(
    private run: Run,
    private arch: Architecture,
    private linux: boolean,
    private sourceDir = import.meta.dir,
    root = process.getuid?.() === 0,
  ) {
    this.privileged = root ? [] : ["sudo", "-n"];
  }
  private async checked(
    args: string[],
    input?: string,
    live = false,
    timeoutMs = 120_000,
  ): Promise<string> {
    const r = await this.run(args, input, live, timeoutMs);
    if (r.code !== 0)
      throw new Error(
        `${args.join(" ")} failed (${r.code}): ${r.stderr || r.stdout}`,
      );
    return r.stdout;
  }
  private async sudo(
    args: string[],
    input?: string,
    live = false,
    timeoutMs?: number,
  ) {
    return this.checked([...this.privileged, ...args], input, live, timeoutMs);
  }
  private kube(
    args: string[],
    input?: string,
    live = false,
    timeoutMs?: number,
  ) {
    // An ambient KUBECONFIG must never redirect this VM add-on to a remote cluster.
    return this.sudo(
      [
        "k3s",
        "kubectl",
        "--kubeconfig=/etc/rancher/k3s/k3s.yaml",
        `--request-timeout=${Math.ceil((timeoutMs ?? 120_000) / 1000)}s`,
        ...args,
      ],
      input,
      live,
      timeoutMs,
    );
  }
  private async get(
    kind: string,
    name: string,
    namespaced = true,
  ): Promise<Resource | null> {
    const text = await this.kube([
      ...(namespaced ? ["-n", namespace] : []),
      "get",
      kind,
      name,
      "--ignore-not-found",
      "-o",
      "json",
    ]);
    return text.trim() ? JSON.parse(text) : null;
  }
  private async preflight(install: boolean) {
    if (!this.linux)
      throw new Error(
        "Run this command inside the Linux Trustant VM (limactl shell trudev).",
      );
    const nodes = JSON.parse(
      await this.kube(["get", "nodes", "-o", "json"]),
    ) as { items: Resource[] };
    if (
      nodes.items.length !== 1 ||
      nodes.items[0]?.status?.nodeInfo?.architecture !== this.arch
    )
      throw new Error(
        "Expected one local k3s node matching the native CPU architecture.",
      );
    const conditions = nodes.items[0].status?.conditions ?? [];
    if (
      install &&
      (!conditions.some((c) => c.type === "Ready" && c.status === "True") ||
        conditions.some(
          (c) => c.type === "DiskPressure" && c.status === "True",
        ))
    ) {
      throw new Error(
        "The local k3s node must be Ready without DiskPressure before installation.",
      );
    }
    const ns = await this.get("namespace", namespace, false);
    assertOwned(ns, `namespace ${namespace}`);
    const resources = new Map<string, Resource | null>();
    if (ns)
      for (const [kind, name] of [
        ["statefulset", "infinity"],
        ["service", "infinity"],
        ["pvc", "model-cache-infinity-0"],
        ["configmap", "infinity-addon"],
      ]) {
        const object = await this.get(kind!, name!);
        assertOwned(object, `${kind}/${name}`);
        resources.set(kind!, object);
      }
    return resources;
  }
  private async stateExists(): Promise<boolean> {
    const args = (a: string[]) => [...this.privileged, ...a];
    if ((await this.run(args(["test", "-L", stateDir]))).code === 0)
      throw new Error("Add-on state directory must not be a symlink.");
    if ((await this.run(args(["test", "-e", stateDir]))).code !== 0)
      return false;
    const marker = await this.sudo(["cat", `${stateDir}/owner`]);
    if (marker.trim() !== owner)
      throw new Error("Unowned local build state; refusing mutation.");
    return true;
  }
  private async buildImage(image: string) {
    const imageNames = (
      await this.sudo(["k3s", "ctr", "images", "ls", "-q"])
    ).split(/\s+/);
    if (imageNames.includes(image)) return;
    for (const binary of ["buildctl", "buildkitd", "runc", "systemd-run"]) {
      try {
        await this.checked(["which", binary]);
      } catch {
        throw new Error(
          `Missing ${binary}: the local image build requires BuildKit, runc and systemd in the Trustant VM. Install those prerequisites, then retry.`,
        );
      }
    }
    const exists = await this.stateExists();
    if (!exists) {
      await this.sudo(["mkdir", "-m", "0700", stateDir]);
      await this.sudo(["tee", `${stateDir}/owner`], `${owner}\n`);
    }
    const unit = await this.run([
      ...this.privileged,
      "systemctl",
      "is-active",
      "--quiet",
      builderUnit,
    ]);
    if (unit.code === 0)
      throw new Error(
        "An Infinity builder is already active; wait for it to finish.",
      );
    const buildkitd = (await this.checked(["which", "buildkitd"])).trim();
    await this.sudo([
      "systemd-run",
      `--unit=${builderUnit}`,
      `--property=RuntimeDirectory=${builderUnit}`,
      "--property=MemoryMax=2G",
      "--property=RuntimeMaxSec=1800",
      buildkitd,
      "--addr",
      builderAddress,
      "--root",
      `${stateDir}/buildkit`,
      "--oci-worker=true",
      "--containerd-worker=false",
    ]);
    try {
      let ready = false;
      for (let n = 0; n < 40; n++) {
        const probe = await this.run([
          ...this.privileged,
          "buildctl",
          "--addr",
          builderAddress,
          "debug",
          "workers",
        ]);
        if (probe.code === 0) {
          ready = true;
          break;
        }
        await Bun.sleep(250);
      }
      if (!ready)
        throw new Error("Dedicated BuildKit worker did not become ready.");
      const context = join(this.sourceDir, "image");
      const archive = `${stateDir}/image.oci.tar`;
      await this.sudo(
        [
          "buildctl",
          "--addr",
          builderAddress,
          "build",
          "--frontend",
          "dockerfile.v0",
          "--local",
          `context=${context}`,
          "--local",
          `dockerfile=${context}`,
          "--opt",
          `platform=linux/${this.arch}`,
          "--output",
          `type=oci,dest=${archive},name=${image}`,
        ],
        undefined,
        true,
        1_800_000,
      );
      await this.sudo(
        ["k3s", "ctr", "images", "import", archive],
        undefined,
        true,
        300_000,
      );
      await this.sudo(["rm", "--", archive]);
    } finally {
      await this.sudo(["systemctl", "stop", builderUnit]);
    }
  }
  private inventory(resources: Map<string, Resource | null>) {
    return validateImages(
      JSON.parse(resources.get("configmap")?.data?.images ?? "[]"),
    );
  }
  async execute(options: Options): Promise<unknown> {
    const image = imageRef(this.arch, this.sourceDir);
    if (options.dryRun)
      return options.command === "install"
        ? { action: "install", image, manifest: manifest(image) }
        : {
            action: "uninstall",
            namespace,
            deleteRuntime: ["statefulset/infinity", "service/infinity"],
            deleteModelCache: options.purge,
            deleteUnusedAddonImages: options.purge,
            deleteOwnedBuildState: options.purge,
          };
    const resources = await this.preflight(options.command === "install");
    if (options.command === "status")
      return {
        namespace,
        installed: !!resources.get("statefulset"),
        ready: resources.get("statefulset")?.status?.readyReplicas === 1,
        cacheRetained: !!resources.get("pvc"),
        cachePhase: resources.get("pvc")?.status?.phase ?? null,
        endpoint: `http://infinity.${namespace}.svc.cluster.local:7997`,
      };
    if (options.command === "install") {
      this.inventory(resources);
      // All ownership checks precede the image build and every Kubernetes write.
      await this.stateExists();
      await this.buildImage(image);
      // Image compilation can take minutes; re-check collisions rather than
      // overwriting a resource created by another operator while it ran.
      const current = await this.preflight(true);
      const inventory = [...new Set([...this.inventory(current), image])];
      await this.kube(
        ["apply", "-f", "-"],
        JSON.stringify(manifest(image, inventory)),
        true,
      );
      await this.kube(
        [
          "-n",
          namespace,
          "rollout",
          "status",
          "statefulset/infinity",
          "--timeout=900s",
        ],
        undefined,
        true,
        930_000,
      );
      const verification = await this.verify();
      // Only a successful inference proves the cache complete. The image's
      // entrypoint can then select offline mode on later starts of this model.
      await this.kube(
        [
          "-n",
          namespace,
          "exec",
          "-i",
          "infinity-0",
          "--",
          "python",
          "-c",
          "import json,os,pathlib,sys; p=pathlib.Path('/cache/model-ready.json'); t=p.with_suffix('.tmp'); t.write_text(json.dumps(json.load(sys.stdin))); os.replace(t,p)",
        ],
        JSON.stringify({ model, revision }),
      );
      return {
        installed: true,
        namespace,
        image,
        endpoint: `http://infinity.${namespace}.svc.cluster.local:7997`,
        verification,
      };
    }
    if (options.command === "test") {
      if (!resources.get("statefulset"))
        throw new Error(
          "Infinity is not installed; run ops truinst infinity first.",
        );
      return this.verify();
    }
    if (options.command === "logs") {
      if (!resources.get("statefulset"))
        throw new Error("Infinity is not installed.");
      await this.kube(
        ["-n", namespace, "logs", "infinity-0", "--tail=100"],
        undefined,
        true,
      );
      return { namespace };
    }
    // Include the desired image so purge can also clean a build whose first
    // Kubernetes apply failed before the inventory ConfigMap was created.
    const inventory = validateImages([...this.inventory(resources), image]);
    const hasState = options.purge && (await this.stateExists());
    if (
      hasState &&
      (
        await this.run([
          ...this.privileged,
          "systemctl",
          "is-active",
          "--quiet",
          builderUnit,
        ])
      ).code === 0
    ) {
      throw new Error(
        "Builder active; wait for it to finish before purge. No resources removed.",
      );
    }
    // Read the complete inventory and validate ownership before removing anything.
    const pods = options.purge
      ? (JSON.parse(await this.kube(["get", "pods", "-A", "-o", "json"])) as {
          items: Resource[];
        })
      : { items: [] };
    const inUse = new Set(
      pods.items
        .filter(
          (p) =>
            p.metadata.namespace !== namespace ||
            p.metadata.name !== "infinity-0",
        )
        .flatMap((p) =>
          [
            ...(p.spec?.containers ?? []),
            ...(p.spec?.initContainers ?? []),
            ...(p.spec?.ephemeralContainers ?? []),
          ].map((c) => c.image),
        ),
    );
    for (const [kind, name] of [
      ["statefulset", "infinity"],
      ["service", "infinity"],
    ])
      if (resources.get(kind!)) {
        await this.kube(
          [
            "-n",
            namespace,
            "delete",
            kind!,
            name!,
            "--ignore-not-found",
            "--cascade=foreground",
            "--wait=true",
            "--timeout=120s",
          ],
          undefined,
          true,
          150_000,
        );
      }
    const retainedImages: string[] = [];
    if (options.purge) {
      if (resources.get("pvc"))
        await this.kube(
          [
            "-n",
            namespace,
            "delete",
            "pvc",
            "model-cache-infinity-0",
            "--wait=true",
            "--timeout=120s",
          ],
          undefined,
          true,
          150_000,
        );
      const existing = (
        await this.sudo(["k3s", "ctr", "images", "ls", "-q"])
      ).split(/\s+/);
      for (const item of inventory) {
        if (inUse.has(item)) retainedImages.push(item);
        else if (existing.includes(item))
          await this.sudo(["k3s", "ctr", "images", "rm", item]);
      }
      if (hasState) {
        await this.sudo(["rm", "-rf", "--", stateDir]);
      }
      if (resources.get("configmap") && retainedImages.length === 0)
        await this.kube(
          [
            "-n",
            namespace,
            "delete",
            "configmap",
            "infinity-addon",
            "--ignore-not-found",
          ],
          undefined,
          true,
        );
    }
    return {
      uninstalled: true,
      cachePreserved: !options.purge,
      retainedImages,
      namespaceRetained: true,
    };
  }
  private async verify() {
    const script = readFileSync(join(this.sourceDir, "verify.py"), "utf8");
    const result = await this.kube(
      [
        "-n",
        namespace,
        "exec",
        "-i",
        "infinity-0",
        "--",
        "python",
        "-",
        `http://infinity.${namespace}.svc.cluster.local:7997`,
      ],
      script,
      false,
      180_000,
    );
    return JSON.parse(result);
  }
}
