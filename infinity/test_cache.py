# Copyright 2025-2026 Nuvolaris Inc
# SPDX-License-Identifier: AGPL-3.0-or-later
# This program is free software under the GNU Affero General Public License as published
# by the Free Software Foundation, version 3 or later. See ../LICENSE.
import json
from pathlib import Path
import tempfile
import unittest

from image.start import verified_cache


class CacheSelectionTests(unittest.TestCase):
    def test_fresh_partial_and_different_model_caches_stay_online(self):
        args = ["v2", "--model-id", "owner/model", "--revision", "a" * 40]
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / "model-ready.json"
            self.assertFalse(verified_cache(args, marker))
            marker.write_text("partial json")
            self.assertFalse(verified_cache(args, marker))
            marker.write_text(
                json.dumps({"model": "owner/model", "revision": "b" * 40})
            )
            self.assertFalse(verified_cache(args, marker))
            marker.write_text(
                json.dumps({"model": "owner/model", "revision": "a" * 40})
            )
            self.assertTrue(verified_cache(args, marker))
            self.assertFalse(verified_cache(["v2", "--help"], marker))


if __name__ == "__main__":
    unittest.main()
