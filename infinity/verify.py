# Copyright 2025-2026 Nuvolaris Inc
# SPDX-License-Identifier: AGPL-3.0-or-later
# This program is free software under the GNU Affero General Public License as published
# by the Free Software Foundation, version 3 or later. See ../LICENSE.
"""Read-only inference check through the add-on's internal Kubernetes Service."""

import json
import math
import platform
import sys
import time
import urllib.request

import infinity_emb
import torch

base = sys.argv[1]
with urllib.request.urlopen(base + "/health", timeout=30) as response:
    json.load(response)
with urllib.request.urlopen(base + "/models", timeout=30) as response:
    models = json.load(response)
assert any(m["id"] == "embeddings" and m["backend"] == "torch" for m in models["data"])
texts = [
    "query: Come posso installare un programma su Ubuntu?",
    "passage: Per installare un programma su Ubuntu usa il gestore dei pacchetti apt.",
    "passage: Il gatto dorme sul divano vicino alla finestra.",
    "query: Un gatto dorme sul divano.",
]
request = urllib.request.Request(
    base + "/embeddings",
    data=json.dumps({"model": "embeddings", "input": texts}).encode(),
    headers={"Content-Type": "application/json"},
)
start = time.perf_counter()
with urllib.request.urlopen(request, timeout=120) as response:
    result = json.load(response)
elapsed_ms = (time.perf_counter() - start) * 1000
vectors = [d["embedding"] for d in sorted(result["data"], key=lambda d: d["index"])]
assert len(vectors) == len(texts)
assert all(len(v) == 384 and all(math.isfinite(x) for x in v) for v in vectors)


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b)) / math.sqrt(
        sum(x * x for x in a) * sum(y * y for y in b)
    )


assert cosine(vectors[0], vectors[1]) > cosine(vectors[0], vectors[2])
assert cosine(vectors[3], vectors[2]) > cosine(vectors[3], vectors[1])
assert platform.machine() in ("aarch64", "x86_64")
assert torch.version.cuda is None and not torch.cuda.is_available()
assert infinity_emb.__version__ == "0.0.78"
print(
    json.dumps(
        {
            "ok": True,
            "architecture": platform.machine(),
            "infinity": infinity_emb.__version__,
            "torch": torch.__version__,
            "device": "cpu",
            "dimensions": 384,
            "italian_semantic_checks": 2,
            "service": base,
            "batch_4_ms": round(elapsed_ms, 2),
        }
    )
)
