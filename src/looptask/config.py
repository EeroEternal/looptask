from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import ExternalDataSource, Loop, Project, Verifier


class ConfigError(ValueError):
    """Raised when a looptask configuration file is invalid."""


def load_config(path: Path) -> tuple[Project, list[Loop]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigError(f"Invalid JSON in {path}: {exc}") from exc

    project = _parse_project(raw.get("project"))
    loops = [_parse_loop(item) for item in _require_list(raw, "loops")]
    if not loops:
        raise ConfigError("Config must define at least one loop.")
    return project, loops


def find_loop(loops: list[Loop], name: str) -> Loop:
    for loop in loops:
        if loop.name == name:
            return loop
    available = ", ".join(loop.name for loop in loops)
    raise ConfigError(f"Loop '{name}' not found. Available loops: {available}")


def _parse_project(raw: Any) -> Project:
    if not isinstance(raw, dict):
        raise ConfigError("Config must include a 'project' object.")

    return Project(
        name=_require_str(raw, "name"),
        repository=_optional_str(raw, "repository"),
        default_branch=raw.get("defaultBranch", "main"),
        tech_stack=tuple(_optional_str_list(raw, "techStack")),
        docs=tuple(_optional_str_list(raw, "docs")),
        source_paths=tuple(_optional_str_list(raw, "sourcePaths")),
        commands=_parse_commands(raw.get("commands", {})),
        external_data_sources=tuple(
            _parse_data_source(item)
            for item in raw.get("externalDataSources", [])
        ),
    )


def _parse_loop(raw: Any) -> Loop:
    if not isinstance(raw, dict):
        raise ConfigError("Each loop entry must be an object.")

    mode = raw.get("mode", "report-only")
    if mode not in {"report-only", "safe-pr", "human-gated"}:
        raise ConfigError(f"Invalid loop mode: {mode}")

    agent = raw.get("agent", {})
    if agent is None:
        agent = {}
    if not isinstance(agent, dict):
        raise ConfigError("Loop 'agent' must be an object when provided.")

    state = raw.get("state", {})
    if state is None:
        state = {}
    if not isinstance(state, dict):
        raise ConfigError("Loop 'state' must be an object when provided.")

    return Loop(
        name=_require_str(raw, "name"),
        type=_require_str(raw, "type"),
        goal=_require_str(raw, "goal"),
        mode=mode,
        trigger=_optional_dict(raw, "trigger"),
        agent_command=_optional_command(agent, "command"),
        verifiers=tuple(_parse_verifier(item) for item in raw.get("verifiers", [])),
        state_path=_optional_str(state, "path"),
        report_dir=raw.get("reportDir", ".looptask/runs"),
        stop_rules=_optional_dict(raw, "stopRules"),
        escalation_rules=tuple(_optional_str_list(raw, "escalationRules")),
    )


def _parse_data_source(raw: Any) -> ExternalDataSource:
    if not isinstance(raw, dict):
        raise ConfigError("Each external data source must be an object.")
    return ExternalDataSource(
        name=_require_str(raw, "name"),
        url=_optional_str(raw, "url"),
        cache_path=_optional_str(raw, "cachePath"),
        schema_path=_optional_str(raw, "schemaPath"),
    )


def _parse_verifier(raw: Any) -> Verifier:
    if not isinstance(raw, dict):
        raise ConfigError("Each verifier must be an object.")
    return Verifier(
        name=_require_str(raw, "name"),
        command=_require_command(raw, "command"),
        timeout_seconds=int(raw.get("timeoutSeconds", 300)),
    )


def _parse_commands(raw: Any) -> dict[str, list[str]]:
    if not isinstance(raw, dict):
        raise ConfigError("Project 'commands' must be an object.")
    return {str(name): _coerce_command(value, f"commands.{name}") for name, value in raw.items()}


def _require_list(raw: dict[str, Any], key: str) -> list[Any]:
    value = raw.get(key)
    if not isinstance(value, list):
        raise ConfigError(f"Config field '{key}' must be a list.")
    return value


def _require_str(raw: dict[str, Any], key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"Config field '{key}' must be a non-empty string.")
    return value


def _optional_str(raw: dict[str, Any], key: str) -> str | None:
    value = raw.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ConfigError(f"Config field '{key}' must be a string.")
    return value


def _optional_str_list(raw: dict[str, Any], key: str) -> list[str]:
    value = raw.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ConfigError(f"Config field '{key}' must be a list of strings.")
    return value


def _optional_dict(raw: dict[str, Any], key: str) -> dict[str, Any]:
    value = raw.get(key, {})
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(f"Config field '{key}' must be an object.")
    return value


def _require_command(raw: dict[str, Any], key: str) -> list[str]:
    if key not in raw:
        raise ConfigError(f"Config field '{key}' is required.")
    return _coerce_command(raw[key], key)


def _optional_command(raw: dict[str, Any], key: str) -> list[str] | None:
    if key not in raw:
        return None
    return _coerce_command(raw[key], key)


def _coerce_command(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not value or not all(isinstance(item, str) for item in value):
        raise ConfigError(f"Command '{label}' must be a non-empty string array.")
    return value

