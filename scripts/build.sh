#!/usr/bin/env bash
set -euo pipefail

# Replit packages the workspace after this script finishes. Remove local Rust
# dev/test artifacts first so target/debug does not push the image over 8 GiB.
cargo clean
npm --prefix web run build
cargo build --release