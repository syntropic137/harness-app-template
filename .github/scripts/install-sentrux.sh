#!/usr/bin/env bash
# Install sentrux for CI (chore/fresh-clone-validation: closes the
# silent-skip hole where harness/sensors/sentrux_scan.mjs reports
# `available: false` whenever the sentrux binary is missing from PATH,
# so sentrux-* metrics in baseline.json (sentrux-quality-signal,
# sentrux-complex-fn-count, sentrux-coupling-score, etc.) get treated
# as no-reading and the gate cannot enforce them).
#
# Without this install step the CI fitness gate green-lights PRs that
# regress the sentrux 2nd architectural lens, then `just qa` and
# `just fitness` fail for any adopter who happens to have sentrux on
# PATH (the documented optional install at harness/sensors/README.md).
#
# Strategy mirrors install-gitleaks.sh: direct binary download from
# the official sentrux GitHub release, with the artifact SHA-256
# pinned IN THIS SCRIPT so a version bump is a reviewable diff.
#
# Source of pinned checksum (sentrux-linux-x86_64@v0.5.7):
#   harness/sensors/README.md (verified at install time on
#   2026-06-10).
set -euo pipefail

VERSION="0.5.7"

case "$(uname -s)" in
  Linux)  OS=linux ;;
  Darwin) OS=darwin ;;
  *) printf 'install-sentrux: unsupported OS: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  ARCH=x86_64 ;;
  arm64|aarch64) ARCH=aarch64 ;;
  *) printf 'install-sentrux: unsupported arch: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

# Asset naming on the sentrux release page is `sentrux-<os>-<arch>`
# for Linux/macOS (no archive wrapper). Windows is `.exe` and out of
# scope for the GitHub Linux runners that drive the fitness CI job.
asset="sentrux-${OS}-${ARCH}"

expected=""
case "${OS}_${ARCH}" in
  linux_x86_64)   expected="3237f80fe20d54aad4deefa8a143f0d60543bb5d2d6ad891eb42432f155725a6" ;;
  linux_aarch64)  expected="" ;;
  darwin_x86_64)  expected="" ;;
  darwin_aarch64) expected="" ;;
  *) printf 'install-sentrux: no pinned checksum for %s_%s; bump VERSION + update the case table.\n' "$OS" "$ARCH" >&2; exit 1 ;;
esac

if [ -z "$expected" ]; then
  printf 'install-sentrux: pinned checksum missing for %s_%s; verify upstream + paste into the script before re-running.\n' "$OS" "$ARCH" >&2
  exit 1
fi

url="https://github.com/sentrux/sentrux/releases/download/v${VERSION}/${asset}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

printf 'install-sentrux: downloading %s\n' "$url" >&2
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$url" -o "$tmpdir/$asset"

actual="$(shasum -a 256 "$tmpdir/$asset" | awk '{print $1}')"
if [ "$actual" != "$expected" ]; then
  printf 'install-sentrux: checksum mismatch for %s\n  expected %s\n  actual   %s\n' "$asset" "$expected" "$actual" >&2
  exit 1
fi
printf 'install-sentrux: checksum verified (%s)\n' "$expected" >&2

dest="${SENTRUX_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dest"
install -m 0755 "$tmpdir/$asset" "$dest/sentrux"

if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$dest" >> "$GITHUB_PATH"
fi

"$dest/sentrux" --version
