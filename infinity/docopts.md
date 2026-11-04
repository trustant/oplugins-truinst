# Tasks `ops truinst infinity`

Optional CPU embedding service for the local Trustant VM. The bare command installs it.

## Synopsis

```text
Usage:
    infinity install [--dry-run]
    infinity status
    infinity test
    infinity logs
    infinity uninstall [--purge] [--dry-run]
    infinity help
```

## Options

```text
    --dry-run    Print the operation without contacting or changing the VM.
    --purge      Also delete the owned model cache and unused add-on build artifacts.
```

## Commands

```text
    install      Install the independent CPU image and service.
    status       Show the running service and retained model cache.
    test         Check real Italian embeddings and CPU-only execution.
    logs         Show the last 100 server log lines.
    uninstall    Remove the service; keep the cache unless --purge is supplied.
    help         Show command usage.
```
