from __future__ import annotations

from .models import CommandResult, RunRecord


def render_markdown(record: RunRecord) -> str:
    lines = [
        f"# looptask run: {record.loop_name}",
        "",
        f"- Project: `{record.project_name}`",
        f"- Loop type: `{record.loop_type}`",
        f"- Status: `{record.status}`",
        f"- Started: `{record.started_at}`",
        f"- Ended: `{record.ended_at}`",
        "",
        "## Summary",
        "",
        record.analysis.summary,
        "",
        "## Findings",
        "",
    ]
    lines.extend(_bullets(record.analysis.findings))
    lines.extend(["", "## Suggested actions", ""])
    lines.extend(_bullets(record.analysis.actions))

    if record.agent_result:
        lines.extend(["", "## Agent command", ""])
        lines.extend(_command_block(record.agent_result))

    lines.extend(["", "## Verifiers", ""])
    if record.verifier_results:
        for result in record.verifier_results:
            lines.extend(_command_block(result))
            lines.append("")
    else:
        lines.append("- No verifiers configured.")

    if record.analysis.changed_files:
        lines.extend(["", "## Changed files", ""])
        lines.extend(_bullets(record.analysis.changed_files))

    return "\n".join(lines).rstrip() + "\n"


def _bullets(items: list[str]) -> list[str]:
    if not items:
        return ["- None."]
    return [f"- {item}" for item in items]


def _command_block(result: CommandResult) -> list[str]:
    command = " ".join(result.command)
    status = "passed" if result.passed else "failed"
    lines = [
        f"### {result.name}",
        "",
        f"- Command: `{command}`",
        f"- Exit code: `{result.exit_code}` ({status})",
    ]
    if result.stdout.strip():
        lines.extend(["", "Stdout:", "", "```text", result.stdout.strip(), "```"])
    if result.stderr.strip():
        lines.extend(["", "Stderr:", "", "```text", result.stderr.strip(), "```"])
    return lines

