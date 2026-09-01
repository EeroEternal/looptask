from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from .commands import run_command
from .loops import analyze
from .models import Loop, LoopStatus, Project, RunRecord
from .reporting import render_markdown


def run_loop(project: Project, loop: Loop, project_root: Path) -> RunRecord:
    started_at = _now()
    state_path = project_root / (loop.state_path or f".looptask/state/{loop.name}.json")
    state = _load_state(state_path)

    analysis = analyze(project, loop, project_root, state)
    agent_result = None
    if loop.agent_command:
        agent_result = run_command("agent", loop.agent_command, project_root, 900)

    verifier_results = [
        run_command(verifier.name, verifier.command, project_root, verifier.timeout_seconds)
        for verifier in loop.verifiers
    ]
    ended_at = _now()
    status = _status(analysis.needs_human, agent_result, verifier_results)

    record = RunRecord(
        loop_name=loop.name,
        loop_type=loop.type,
        project_name=project.name,
        started_at=started_at,
        ended_at=ended_at,
        status=status,
        analysis=analysis,
        agent_result=agent_result,
        verifier_results=verifier_results,
        state_path=state_path,
    )

    report_path = _write_report(project_root / loop.report_dir, record)
    record.report_path = report_path
    _write_state(state_path, record)
    return record


def _status(needs_human: bool, agent_result, verifier_results) -> LoopStatus:
    if agent_result and not agent_result.passed:
        return "failed"
    if any(not result.passed for result in verifier_results):
        return "failed"
    if needs_human:
        return "needs-human"
    return "passed"


def _load_state(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"stateReadError": f"Invalid JSON state at {path}"}


def _write_state(path: Path, record: RunRecord) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {
        "lastRunStartedAt": record.started_at,
        "lastRunEndedAt": record.ended_at,
        "lastStatus": record.status,
        "lastReportPath": str(record.report_path) if record.report_path else None,
        "lastFindingCount": len(record.analysis.findings),
    }
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _write_report(report_dir: Path, record: RunRecord) -> Path:
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = record.started_at.replace(":", "").replace("-", "")
    path = report_dir / f"{stamp}-{record.loop_name}.md"
    path.write_text(render_markdown(record), encoding="utf-8")
    return path


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")

