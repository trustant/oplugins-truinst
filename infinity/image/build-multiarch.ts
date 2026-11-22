// Copyright 2025-2026 Nuvolaris Inc
// SPDX-License-Identifier: AGPL-3.0-or-later
// This program is free software under the GNU Affero General Public License as published
// by the Free Software Foundation, version 3 or later. See ../../LICENSE.
// Explicit standalone release preparation; it never publishes or calls the product build.
const [image, output, ...extra] = process.argv.slice(2);
if (
  !image ||
  !output ||
  extra.length ||
  !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]+:[a-zA-Z0-9._-]+$/.test(image) ||
  !output.endsWith(".tar")
) {
  console.error(
    "Usage: bun build-multiarch.ts <repository:version> <output.oci.tar>\nRequires a Docker Buildx builder supporting linux/amd64 and linux/arm64. No image is pushed.",
  );
  process.exit(1);
}
const result = Bun.spawnSync(
  [
    "docker",
    "buildx",
    "build",
    "--platform",
    "linux/amd64,linux/arm64",
    "--tag",
    image,
    "--output",
    `type=oci,dest=${output}`,
    import.meta.dir,
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
process.exit(result.exitCode);
