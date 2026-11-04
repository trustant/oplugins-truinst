# Infinity CPU add-on

## Scope and independence

Infinity is an opt-in add-on for the local Linux Trustant k3s VM, with native
AMD64 and ARM64 CPU support. It is not part of the Trustant executable/image,
prepared VM payload, ordinary build, `trustant deploy`, `redeploy`, or
`undeploy`. It does not change the product's image/version in `opsroot.json`.
The public interface belongs to this plugin's tasks, not the OPS binary.

## Commands

- `ops truinst infinity` is only a namespace: without a subcommand it displays
  usage and never starts installation or contacts the cluster. The installed
  OPS CLI returns zero for namespace help; this is not installation success.
- `ops truinst infinity install [--dry-run]`: ensure the dedicated image is
  available, apply owned resources, wait for readiness, then run real inference.
- `ops truinst infinity status`: report runtime and retained cache state.
- `ops truinst infinity test`: verify health/models, native CPU-only runtime,
  finite 384-dimensional embeddings, and Italian semantic ordering.
- `ops truinst infinity logs`: show the last 100 log lines.
- `ops truinst infinity uninstall [--purge] [--dry-run]`: remove the runtime;
  default preserves model PVC, image and builder cache. Explicit purge deletes
  the owned PVC, unused add-on image references and owned local builder state.
- `ops truinst infinity help`: show usage without cluster access.

Dry runs render the intended operation without contacting Kubernetes, starting
builders, downloading files, or changing local state. Invalid arguments fail.

## Target and ownership

Operational commands run inside the Linux VM. The only target is local k3s
using `/etc/rancher/k3s/k3s.yaml` explicitly; an ambient kubeconfig cannot select
a different cluster. Non-root callers use passwordless `sudo -n`.
The single node must match the native CPU architecture. Install additionally
requires Ready and no DiskPressure. Removal/status remain available when the
node is under pressure. No resource is created by status/test/help/logs.

Namespace `trustant-infinity`, StatefulSet `infinity`, Service `infinity`,
PVC `model-cache-infinity-0`, and ConfigMap `infinity-addon` belong to the
add-on. Every existing named resource and the namespace must carry
`app.kubernetes.io/managed-by=trustant-infinity-addon` before mutation.
Unowned collisions fail before building/applying/deleting. PVC labels come
from the volume claim template. Uninstall deletes named resources only and
never deletes a namespace wholesale, other apps, or the earlier `infinity-trial`.

Local build state is confined to `/var/lib/trustant-infinity-addon`, requires
an ownership marker and must not be a symlink. Purge checks this marker before
any deletion and never uses a general containerd prune or arbitrary paths.
Active image references used by other pods are retained and reported.

## Dedicated image

Infinity Python/v2 0.0.78 uses a separate pinned Python base image and
architecture-specific hash-locked dependencies. PyTorch must be a CPU wheel;
the build asserts CUDA is absent and checks CLI startup. The image runs as UID 10001. A content-derived local image tag includes the Dockerfile, cache-loading entrypoint and selected
architecture lock, so changing source cannot reuse a stale image silently.

If that image is absent from k3s containerd, install builds it locally using
installed BuildKit tools and a dedicated transient builder, then imports the
OCI archive into k3s. Builder processes are stopped in a finally path;
transient units are collected after stopping. A retry can reset an older failed
unit only after verifying its transient status and exact add-on address/root.
Failures stop installation and do not report success. The temporary OCI archive
is removed after a successful import. Existing unrelated builders are untouched.
Missing prerequisites fail with instructions. There is no image push.
A separate multiarch build script can produce an OCI archive; it is never
called by Trustant's build or deploy flow. Native ARM64 verification does not
establish AMD64 runtime acceptance.

## Runtime and model cache

One non-root replica, internal ClusterIP on 7997, no Ingress/NodePort/host port,
GPU requests or GPU runtime. `enableServiceLinks: false` prevents Kubernetes
from injecting a nonnumeric `INFINITY_PORT`. Startup/readiness/liveness use
`/health`; a successful install also requires the embedding test.
The pod does not mount a Kubernetes service-account token.
Requests: 500m CPU, 1 GiB RAM. Limits: 2 CPU, 3 GiB RAM. Batch size: 4.
A 5 GiB ReadWriteOnce PVC uses the cluster's default storage class and Retain
claim policies. Scale/deletion must not erase the model implicitly.

Model `intfloat/multilingual-e5-small` is pinned to revision
`614241f622f53c4eeff9890bdc4f31cfecc418b3`, served as `embeddings`, with the
`torch` engine, CPU device and float32. The image sets `HF_HOME` to the PVC.
First start permits downloading the public pinned model. After successful
inference, install atomically writes `/cache/model-ready.json` identifying
the exact model/revision. The image entrypoint enables Hugging Face and
Transformers offline mode only when this marker matches the current arguments.
Missing, malformed or mismatching markers stay online. A partial download is
never marked complete merely because files exist. Install does not set offline
mode on an empty PVC. Automatic
remote model code and telemetry are disabled. Runtime requests use local
inference. Changing model or embedding dimension requires updating the spec
and acceptance test; it is not a chat-provider configuration change.

## Lifecycle and errors

Install is repeatable: stable desired resources, retained PVC, content-derived
image reuse, bounded rollout (15 minutes). A nonzero build/import/apply/rollout/
inference check fails the command. Partial installs can be inspected and removed
through the same owned-resource checks. Default uninstall is repeatable and
retains a ConfigMap recording image references for a later explicit purge.
Purge removes that ConfigMap when no image references must be retained, and
removes only unused image references in the add-on's fixed local image repository. Kubernetes retains
physical shared layers until its normal GC reclaims them; image-reference
removal is not a promise of immediate host disk compaction.

## Validation and joint acceptance

Automated tests cover CPU manifest semantics, ownership collisions, local target
selection, no-op/dry-run behavior, retention/purge boundaries, failure
propagation, dependency lock constraints and independence from Trustant deploy.
Harmless OPS routing and status checks run on the actual VM. Before a PR,
perform the following with the user one command at a time: install from an
empty add-on namespace/cache, test, repeat install, default uninstall, confirm
retained PVC, reinstall and test, then explicit purge only when requested.
The earlier trial remains separate throughout. No PR/push/publication occurs
before the user-directed acceptance and explicit publication authorization.
