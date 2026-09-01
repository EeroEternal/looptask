#!/usr/bin/env bash
set -euo pipefail

npm --prefix web run build
cargo build --release