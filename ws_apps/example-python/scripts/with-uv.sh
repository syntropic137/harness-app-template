#!/usr/bin/env sh
set -eu

if ! command -v uv >/dev/null 2>&1; then
  if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
    printf "%s\n" "error: uv not found; Python gate cannot run in CI" >&2
    exit 1
  fi
  printf "%s\n" "warning: uv not found; skipping Python package task" >&2
  exit 0
fi

exec "$@"
