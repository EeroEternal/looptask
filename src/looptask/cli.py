from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import ConfigError, find_loop, load_config
from .runner import run_loop


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="looptask")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run a configured loop.")
    run_parser.add_argument("--config", required=True, type=Path, help="Path to looptask JSON config.")
    run_parser.add_argument("--loop", required=True, help="Loop name to run.")
    run_parser.add_argument(
        "--project-root",
        type=Path,
        default=Path.cwd(),
        help="Project root used for relative config paths.",
    )

    args = parser.parse_args(argv)
    if args.command == "run":
        return _run(args.config, args.loop, args.project_root)
    return 2


def _run(config_path: Path, loop_name: str, project_root: Path) -> int:
    try:
        project, loops = load_config(config_path)
        loop = find_loop(loops, loop_name)
        record = run_loop(project, loop, project_root.resolve())
    except (ConfigError, ValueError) as exc:
        print(f"looptask: {exc}", file=sys.stderr)
        return 2

    print(f"{record.status}: {record.analysis.summary}")
    if record.report_path:
        print(f"report: {record.report_path}")
    return 0 if record.status in {"passed", "needs-human"} else 1


if __name__ == "__main__":
    raise SystemExit(main())

