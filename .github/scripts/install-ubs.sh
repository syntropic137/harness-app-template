#!/usr/bin/env bash
# Install UBS (Ultimate Bug Scanner) for the SC01 security adapter and the
# local ubs-staged / ubs-diff git hooks.
#
# Without ubs on PATH, harness/sensors/bin/sensors soft-skips the SC01
# security adapter (`ubs-security`) and the fitness gate reports SC01 as a
# no-reading — which, under the fail-closed strict profile (ADR-0028), is a
# MISSING REQUIRED failure. The `.claude/hooks/ubs-diff.sh` and lefthook
# `ubs-staged` hooks likewise soft-skip, so bugs are not caught on commit.
# This install activates all three so problems are caught locally first, with
# CI as the backstop.
#
# UBS is a single self-contained Bash meta-runner (MIT + OpenAI/Anthropic
# Rider) that auto-downloads its per-language scanner modules on first run.
# It is fully OFFLINE at scan time — no LLM/API calls, no keys. Strategy
# mirrors install-sentrux.sh / install-gitleaks.sh: download the pinned
# release `ubs` script directly from GitHub with its SHA-256 pinned IN THIS
# SCRIPT, so a version bump is a reviewable diff.
#
# Runtime dependencies (installed separately by the workflow / documented in
# harness/sensors/README.md): bash >= 4.0, jq, ripgrep (rg), ast-grep (sg).
#
# Source of pinned checksum (ubs@v5.3.4, verified 2026-07-07):
#   shasum -a 256 of
#   https://raw.githubusercontent.com/Dicklesworthstone/ultimate_bug_scanner/v5.3.4/ubs
set -euo pipefail

VERSION="5.3.4"
expected="2fe136285e26e717168352f9a64a38668a1c38855766874f24e12e65f11514fb"

url="https://raw.githubusercontent.com/Dicklesworthstone/ultimate_bug_scanner/v${VERSION}/ubs"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

printf 'install-ubs: downloading %s\n' "$url" >&2
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$url" -o "$tmpdir/ubs"

actual="$(shasum -a 256 "$tmpdir/ubs" | awk '{print $1}')"
if [ "$actual" != "$expected" ]; then
  printf 'install-ubs: checksum mismatch for ubs@v%s\n  expected %s\n  actual   %s\n' \
    "$VERSION" "$expected" "$actual" >&2
  exit 1
fi
printf 'install-ubs: checksum verified (%s)\n' "$expected" >&2

dest="${UBS_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dest"
install -m 0755 "$tmpdir/ubs" "$dest/ubs"

if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$dest" >> "$GITHUB_PATH"
fi

printf 'install-ubs: installed ubs@v%s to %s/ubs\n' "$VERSION" "$dest" >&2
