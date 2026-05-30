#!/usr/bin/env bash
set -euo pipefail

# Claude file-write guard: scan only the current working-tree diff, never the
# full repository. Findings are mirrored into beads JSONL for later triage.
if ! command -v ubs >/dev/null 2>&1; then
  echo "[ubs-diff] skipped: install ubs to enable Claude file-write bug scanning" >&2
  exit 0
fi

mkdir -p .beads
ubs --diff --beads-jsonl .beads/ubs-findings.jsonl
