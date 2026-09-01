from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


LoopMode = Literal["report-only", "safe-pr", "human-gated"]
LoopStatus = Literal["passed", "failed", "needs-human", "error"]


@dataclass(frozen=True)
class ExternalDataSource:
    name: str
    url: str | None = None
    cache_path: str | None = None
    schema_path: str | None = None


@dataclass(frozen=True)
class Project:
    name: str
    repository: str | None = None
    default_branch: str = "main"
    tech_stack: tuple[str, ...] = ()
    docs: tuple[str, ...] = ()
    source_paths: tuple[str, ...] = ()
    commands: dict[str, list[str]] = field(default_factory=dict)
    external_data_sources: tuple[ExternalDataSource, ...] = ()


@dataclass(frozen=True)
class Verifier:
    name: str
    command: list[str]
    timeout_seconds: int = 300


@dataclass(frozen=True)
class Loop:
    name: str
    type: str
    goal: str
    mode: LoopMode = "report-only"
    trigger: dict[str, Any] = field(default_factory=dict)
    agent_command: list[str] | None = None
    verifiers: tuple[Verifier, ...] = ()
    state_path: str | None = None
    report_dir: str = ".looptask/runs"
    stop_rules: dict[str, Any] = field(default_factory=dict)
    escalation_rules: tuple[str, ...] = ()


@dataclass
class CommandResult:
    name: str
    command: list[str]
    exit_code: int
    stdout: str
    stderr: str

    @property
    def passed(self) -> bool:
        return self.exit_code == 0


@dataclass
class LoopAnalysis:
    summary: str
    findings: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    changed_files: list[str] = field(default_factory=list)
    needs_human: bool = False


@dataclass
class RunRecord:
    loop_name: str
    loop_type: str
    project_name: str
    started_at: str
    ended_at: str
    status: LoopStatus
    analysis: LoopAnalysis
    agent_result: CommandResult | None = None
    verifier_results: list[CommandResult] = field(default_factory=list)
    report_path: Path | None = None
    state_path: Path | None = None

