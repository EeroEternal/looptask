# looptask

`looptask` is a lightweight, config-first Loop Engineering runner for personal
and small-team development projects.

It is designed for recurring AI-assisted development maintenance loops: discover
work, call an optional agent command, verify the result, save state, and decide
whether the loop should stop, report, or escalate to a human.

## What it is

Loop Engineering shifts work from manually prompting an AI agent turn by turn to
designing an outer loop that can:

- discover repeatable project maintenance tasks
- run a focused agent or analyzer
- verify the result independently
- persist state across runs
- stop safely or escalate when confidence is low

`looptask` starts with three practical loops:

1. **Documentation sync**: scan docs and project files for drift signals and
   produce a report that can guide documentation updates.
2. **External data sync**: inspect configured external data sources and local
   cache files before a sync job overwrites project data.
3. **Architecture decoupling scan**: find large files, cross-module references,
   and Python import cycles that may indicate coupling hotspots.

## Current MVP

The MVP is a local CLI runner. It reads a project configuration file, executes a
named loop, optionally runs a configured agent command, runs command verifiers,
saves loop state, and writes a markdown run report.

```bash
python -m looptask run --config examples/looptask.json --loop docs-sync
```

Reports are written to `.looptask/runs/` by default. Loop state is written to
`.looptask/state/<loop-name>.json` unless overridden in the loop config.

## Install for local development

```bash
python -m pip install -e .
python -m unittest discover -s tests
```

The project currently uses only the Python standard library.

## Configuration

`looptask` is configuration-first. A project config describes:

- project metadata
- known docs and source paths
- external data sources
- loop definitions
- optional agent commands
- verifier commands
- stop and escalation rules

See [`examples/looptask.json`](examples/looptask.json) for a complete example.

## Safety model

Loops should start in one of three modes:

- `report-only`: analyze and report, but do not modify project files
- `safe-pr`: allow low-risk generated changes such as docs or cached data
- `human-gated`: require human approval before making code or architecture
  changes

The first implementation intentionally favors reports over automatic code
changes. A loop should only produce automated changes when its goal and verifier
are machine-checkable.

## Core concepts

- **Project**: repository metadata, paths, commands, and data sources
- **Loop**: a repeatable goal with a trigger, agent profile, verifiers, state,
  stop rules, and escalation rules
- **Run**: one execution of a loop, including findings, verifier results, and
  report location
- **State**: persisted memory from previous runs
- **Verifier**: an independent check such as tests, lint, build, schema checks,
  or review commands
- **Escalation**: rules for asking a human to intervene when risk or uncertainty
  is too high
