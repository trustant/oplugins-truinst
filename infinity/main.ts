// Copyright 2025-2026 Nuvolaris Inc
// SPDX-License-Identifier: AGPL-3.0-or-later
// This program is free software under the GNU Affero General Public License as published
// by the Free Software Foundation, version 3 or later. See ../LICENSE.
import { Addon, parseOptions, type Architecture, type Run } from "./core";

export const run: Run = async (
  args,
  input,
  live = false,
  timeoutMs = 120_000,
) => {
  const child = Bun.spawn(args, {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: live ? "inherit" : "pipe",
    stderr: live ? "inherit" : "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      live
        ? Promise.resolve("")
        : new Response(child.stdout as ReadableStream).text(),
      live
        ? Promise.resolve("")
        : new Response(child.stderr as ReadableStream).text(),
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

if (import.meta.main) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (!options) {
      console.log(
        "ops truinst infinity <install | status | test | logs | uninstall [--purge] | help>\nAn explicit subcommand is required. Install/uninstall also accept --dry-run. Run operational commands inside the Linux Trustant VM.",
      );
    } else {
      const arch: Architecture =
        process.arch === "arm64"
          ? "arm64"
          : process.arch === "x64"
            ? "amd64"
            : (() => {
                throw new Error("Supported CPUs: AMD64 and ARM64.");
              })();
      console.log(
        JSON.stringify(
          await new Addon(run, arch, process.platform === "linux").execute(
            options,
          ),
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
