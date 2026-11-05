# Infinity CPU add-on

An optional CPU embedding service for the local Trustant k3s VM.

Run inside the Linux VM, with the normal OPS binary and this plugin installed:

```sh
ops truinst infinity install
ops truinst infinity status
ops truinst infinity test
ops truinst infinity logs
```

An explicit subcommand is required: `ops truinst infinity` alone shows the
available subcommands and does not perform any operation. Installation
builds a dedicated native CPU image if it is missing, imports it into local
k3s, downloads the pinned multilingual embedding model into its own persistent
volume, waits for readiness, and verifies real Italian embeddings. It can take
several minutes the first time and requires internet access for public image,
package and model downloads. Subsequent installs reuse the image and cache.
After successful verification, later model starts use offline cache loading.

Requirements: Linux AMD64 or ARM64, local single-node k3s, passwordless sudo
(or root), and the OPS-bundled Bun. Building a missing image additionally needs
`buildctl`, `buildkitd`, `runc`, and `systemd-run`, as in the tested Trustant
Lima VM. Missing tools are reported; the command does not install a second
container runtime or modify an existing builder. The VM needs disk headroom
for image layers/build cache and approximately 1 GiB working RAM for this
small model. CPU/RAM limits are 2 cores and 3 GiB.

The service is internal to Kubernetes:

```text
http://infinity.trustant-infinity.svc.cluster.local:7997
```

Its API paths are `/health`, `/models`, `/embeddings` and `/docs`; clients use
model `embeddings`. Retrieval inputs for E5 need `query: ` and `passage: `
prefixes. This is an embedding service, not a chat-provider configuration.
For local interactive access, run this in another VM terminal:

```sh
sudo -n k3s kubectl --kubeconfig=/etc/rancher/k3s/k3s.yaml \
  -n trustant-infinity port-forward --address=127.0.0.1 svc/infinity 7998:7997
```

Use port 7998 to keep the earlier developer trial on 7997 separate. Lima can
forward this loopback listener to the Mac, where `/docs` provides Swagger UI.
No Ingress or public port is created by installation.

## Uninstall and data retention

```sh
ops truinst infinity uninstall
```

This stops/removes the add-on's StatefulSet and Service. The model PVC, image
references, inventory ConfigMap and builder cache are kept for reinstall.

```sh
ops truinst infinity uninstall --purge
```

Explicit purge additionally deletes the owned model PVC and local build cache,
removes unused add-on image references and, when no references are retained,
removes the inventory ConfigMap. It retains the namespace, never deletes other
apps or the `infinity-trial` namespace, and never runs a general image prune.
Images used by other pods are retained and reported. Containerd can retain
shared physical layers until normal garbage collection runs.

Preview without contacting or changing the VM:

```sh
ops truinst infinity install --dry-run
ops truinst infinity uninstall --purge --dry-run
```

## Independent image and development

Nothing adds Infinity to the Trustant executable/image, normal build,
installation payload, or ordinary deploy/redeploy/undeploy tasks. `opsroot.json`
continues to describe the Trustant image only. The add-on has a separate
Dockerfile and hash-locked CPU dependencies for AMD64 and ARM64. Local image
tags include the architecture and source hash. No command publishes images.
From this directory, prepare a multiarch OCI archive on a configured Docker
Buildx builder:

```sh
bun image/build-multiarch.ts example/infinity-cpu:0.0.78 infinity-cpu.oci.tar
```

This is an explicit standalone build, never called by the product build. An
archive build does not establish native runtime acceptance on both platforms.

All add-on sources, documentation, dependency locks and development configuration
are contained in this directory, which can be copied or moved independently.
Run the following commands from this directory. Runtime orchestration uses only
Bun and standard modules; package dependencies are developer tools, not an
install prerequisite:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
```

See [spec/infinity.md](spec/infinity.md) for the ownership/lifecycle contract.
Before opening a PR, run the joint acceptance sequence with the user: first
install, real inference test, repeated install, default uninstall, retained
cache status, reinstall/test, and explicit purge only when requested.

To exercise an unpublished local fork, put the `oplugins-truinst` checkout
under a directory selected by `OPS_ROOT_PLUGIN`, or link that checkout at
`~/.ops/oplugins-truinst`. A plugin in the current project takes precedence
over the globally installed plugin, so select the intended fork explicitly
when an older project copy exists.
