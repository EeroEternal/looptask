from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from looptask.config import find_loop, load_config
from looptask.runner import run_loop


class RunnerTests(unittest.TestCase):
    def test_docs_loop_writes_report_and_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "README.md").write_text("# Demo\n", encoding="utf-8")
            config = root / "looptask.json"
            config.write_text(
                json.dumps(
                    {
                        "project": {
                            "name": "demo",
                            "docs": ["README.md"],
                            "sourcePaths": ["src"],
                        },
                        "loops": [
                            {
                                "name": "docs-sync",
                                "type": "docs_sync",
                                "goal": "Keep docs current.",
                                "state": {"path": ".looptask/state/docs.json"},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            project, loops = load_config(config)

            record = run_loop(project, find_loop(loops, "docs-sync"), root)

            self.assertEqual(record.status, "passed")
            self.assertIsNotNone(record.report_path)
            self.assertTrue(record.report_path.exists())
            self.assertTrue((root / ".looptask/state/docs.json").exists())

    def test_architecture_loop_flags_large_file_as_human_gated(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "src"
            src.mkdir()
            (src / "large.py").write_text("\n".join(["print('x')"] * 5), encoding="utf-8")
            config = root / "looptask.json"
            config.write_text(
                json.dumps(
                    {
                        "project": {"name": "demo", "sourcePaths": ["src"]},
                        "loops": [
                            {
                                "name": "arch",
                                "type": "architecture_scan",
                                "goal": "Find coupling.",
                                "stopRules": {"largeFileLines": 2},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            project, loops = load_config(config)

            record = run_loop(project, find_loop(loops, "arch"), root)

            self.assertEqual(record.status, "needs-human")
            self.assertIn("large.py", "\n".join(record.analysis.findings))


if __name__ == "__main__":
    unittest.main()

