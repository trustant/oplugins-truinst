# Copyright 2025-2026 Nuvolaris Inc
# SPDX-License-Identifier: AGPL-3.0-or-later
# This program is free software under the GNU Affero General Public License as published
# by the Free Software Foundation, version 3 or later. See ../../LICENSE.
"""Use offline model loading only after an actual successful inference check."""

import json
import os
from pathlib import Path
import sys


def verified_cache(arguments, cache=Path("/cache/model-ready.json")):
    try:
        model = arguments[arguments.index("--model-id") + 1]
        revision = arguments[arguments.index("--revision") + 1]
        return json.loads(cache.read_text()) == {"model": model, "revision": revision}
    except (OSError, ValueError, IndexError):
        return False


if __name__ == "__main__":
    if verified_cache(sys.argv[1:]):
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.execvp("infinity_emb", ["infinity_emb", *sys.argv[1:]])
