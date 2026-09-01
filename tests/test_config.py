from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from looptask.config import ConfigError, find_loop, load_config


class ConfigTests(unittest.TestCase):
    def test_loads_project_and_loop(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "looptask.json"
            path.write_text(
                json.dumps(
                    {
                        "project": {"name": "demo", "docs": ["README.md"]},
                        "loops": [
                            {
                                "name": "docs",
                                "type": "docs_sync",
                                "goal": "Keep docs current.",
                                "verifiers": [
                                    {"name": "test", "command": ["python", "-m", "unittest"]}
                                ],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            project, loops = load_config(path)

        self.assertEqual(project.name, "demo")
        self.assertEqual(find_loop(loops, "docs").type, "docs_sync")
        self.assertEqual(loops[0].verifiers[0].command, ["python", "-m", "unittest"])

    def test_rejects_string_commands(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "looptask.json"
            path.write_text(
                json.dumps(
                    {
                        "project": {"name": "demo"},
                        "loops": [
                            {
                                "name": "docs",
                                "type": "docs_sync",
                                "goal": "Keep docs current.",
                                "verifiers": [{"name": "bad", "command": "pytest"}],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaises(ConfigError):
                load_config(path)


if __name__ == "__main__":
    unittest.main()

