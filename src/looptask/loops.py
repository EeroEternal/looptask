from __future__ import annotations

import ast
from collections import defaultdict
from pathlib import Path
from typing import Callable

from .models import Loop, LoopAnalysis, Project


Analyzer = Callable[[Project, Loop, Path, dict], LoopAnalysis]


def analyze(project: Project, loop: Loop, project_root: Path, state: dict) -> LoopAnalysis:
    analyzers: dict[str, Analyzer] = {
        "docs_sync": docs_sync,
        "external_data_sync": external_data_sync,
        "architecture_scan": architecture_scan,
    }
    try:
        analyzer = analyzers[loop.type]
    except KeyError as exc:
        known = ", ".join(sorted(analyzers))
        raise ValueError(f"Unknown loop type '{loop.type}'. Known types: {known}") from exc
    return analyzer(project, loop, project_root, state)


def docs_sync(project: Project, loop: Loop, project_root: Path, state: dict) -> LoopAnalysis:
    doc_paths = _existing_paths(project_root, project.docs)
    source_paths = _existing_paths(project_root, project.source_paths)
    findings: list[str] = []
    actions: list[str] = []

    if not doc_paths:
        findings.append("No configured documentation paths exist.")
        actions.append("Add documentation paths to project.docs or create the missing docs.")
        return LoopAnalysis("Documentation sync needs setup.", findings, actions, needs_human=True)

    stale_markers = ("TODO", "FIXME", "TBD", "outdated", "deprecated")
    marker_hits = []
    for path in _iter_text_files(doc_paths):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for marker in stale_markers:
            if marker.lower() in text.lower():
                marker_hits.append(_relative(project_root, path))
                break

    if marker_hits:
        findings.append(f"Found stale-documentation markers in: {', '.join(marker_hits)}.")
        actions.append("Review marker hits and update or remove stale notes.")

    if source_paths:
        newest_source = _newest_mtime(source_paths)
        newest_doc = _newest_mtime(doc_paths)
        if newest_source and newest_doc and newest_source > newest_doc:
            findings.append("Source files are newer than documentation paths.")
            actions.append("Review recent source changes and update docs if behavior changed.")

    last_run = state.get("lastRunEndedAt")
    if last_run:
        findings.append(f"Previous run ended at {last_run}.")

    summary = "Documentation sync completed with findings." if findings else "Documentation appears in sync."
    return LoopAnalysis(summary, findings, actions)


def external_data_sync(project: Project, loop: Loop, project_root: Path, state: dict) -> LoopAnalysis:
    findings: list[str] = []
    actions: list[str] = []

    if not project.external_data_sources:
        return LoopAnalysis(
            "External data sync needs setup.",
            ["No external data sources are configured."],
            ["Add project.externalDataSources entries with name, url, cachePath, and optional schemaPath."],
            needs_human=True,
        )

    for source in project.external_data_sources:
        if not source.url:
            findings.append(f"{source.name}: missing source URL.")
        if not source.cache_path:
            findings.append(f"{source.name}: missing local cache path.")
            continue

        cache_path = project_root / source.cache_path
        if cache_path.exists():
            findings.append(f"{source.name}: cache exists at {source.cache_path}.")
        else:
            findings.append(f"{source.name}: cache file does not exist at {source.cache_path}.")
            actions.append(f"Create initial cache for {source.name} before enabling automated overwrite.")

        if source.schema_path and not (project_root / source.schema_path).exists():
            findings.append(f"{source.name}: schema path is configured but missing: {source.schema_path}.")
            actions.append(f"Add schema validation for {source.name} before safe-pr mode.")

    if loop.mode == "safe-pr":
        actions.append("Only overwrite cache files after schema validation and a non-empty change summary.")

    return LoopAnalysis("External data source preflight completed.", findings, actions)


def architecture_scan(project: Project, loop: Loop, project_root: Path, state: dict) -> LoopAnalysis:
    paths = _existing_paths(project_root, project.source_paths) or [project_root]
    findings: list[str] = []
    actions: list[str] = []

    large_file_limit = int(loop.stop_rules.get("largeFileLines", 500))
    for path in _iter_text_files(paths):
        if ".git" in path.parts or ".looptask" in path.parts:
            continue
        try:
            with path.open(encoding="utf-8", errors="ignore") as file:
                line_count = sum(1 for _ in file)
        except OSError:
            continue
        if line_count > large_file_limit:
            findings.append(f"{_relative(project_root, path)} has {line_count} lines.")
            actions.append("Review large files for possible module extraction.")

    python_files = [path for path in _iter_text_files(paths) if path.suffix == ".py"]
    cycles = _find_python_import_cycles(project_root, python_files)
    for cycle in cycles[:10]:
        findings.append("Python import cycle: " + " -> ".join(cycle))
        actions.append("Break import cycles by extracting shared interfaces or moving side-effect imports.")

    if not findings:
        return LoopAnalysis("No obvious architecture coupling hotspots found.")

    return LoopAnalysis(
        "Architecture scan found coupling candidates.",
        findings,
        actions,
        needs_human=True,
    )


def _existing_paths(project_root: Path, paths: tuple[str, ...]) -> list[Path]:
    return [project_root / path for path in paths if (project_root / path).exists()]


def _iter_text_files(paths: list[Path]):
    for path in paths:
        if path.is_file():
            yield path
        elif path.is_dir():
            for child in path.rglob("*"):
                if child.is_file() and not _is_binary_like(child):
                    yield child


def _is_binary_like(path: Path) -> bool:
    return path.suffix.lower() in {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".ico",
        ".pdf",
        ".zip",
        ".gz",
        ".tar",
        ".sqlite",
    }


def _newest_mtime(paths: list[Path]) -> float | None:
    mtimes = [path.stat().st_mtime for path in _iter_text_files(paths)]
    return max(mtimes) if mtimes else None


def _relative(root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _find_python_import_cycles(project_root: Path, python_files: list[Path]) -> list[list[str]]:
    modules = {_module_name(project_root, path): path for path in python_files}
    graph: dict[str, set[str]] = defaultdict(set)

    for module, path in modules.items():
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            imported = _imported_module(node)
            if imported and imported in modules:
                graph[module].add(imported)

    cycles: list[list[str]] = []
    visiting: list[str] = []
    visited: set[str] = set()

    def visit(module: str) -> None:
        if module in visiting:
            cycle = visiting[visiting.index(module):] + [module]
            if cycle not in cycles:
                cycles.append(cycle)
            return
        if module in visited:
            return
        visiting.append(module)
        for dependency in graph[module]:
            visit(dependency)
        visiting.pop()
        visited.add(module)

    for module in sorted(modules):
        visit(module)
    return cycles


def _module_name(project_root: Path, path: Path) -> str:
    relative = path.relative_to(project_root).with_suffix("")
    if relative.name == "__init__":
        relative = relative.parent
    return ".".join(relative.parts)


def _imported_module(node: ast.AST) -> str | None:
    if isinstance(node, ast.Import):
        return node.names[0].name if node.names else None
    if isinstance(node, ast.ImportFrom) and node.module:
        return node.module
    return None
