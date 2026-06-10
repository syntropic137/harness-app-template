#!/usr/bin/env bash
# Install gitleaks for CI (fix/gitleaks-install: replaces the broken
# taiki-e/install-action@v2 path — that action does not ship gitleaks
# and its cargo-binstall fallback also fails because gitleaks is not a
# crate, so PR #22's CI was red on main).
#
# Strategy: direct binary download from the official gitleaks GitHub
# release, with the release artifact's SHA-256 pinned IN THIS SCRIPT
# (not fetched from the same release, which would defeat the purpose).
# A version bump becomes a reviewable diff.
#
# Source of pinned checksums for v8.24.2:
#   https://github.com/gitleaks/gitleaks/releases/download/v8.24.2/gitleaks_8.24.2_checksums.txt
# Verify upstream before bumping by re-fetching that file and comparing
# the relevant lines.
#
# Runs on the matrix used by .github/workflows/test.yml (ubuntu-latest +
# macos-latest, both x86_64 today, with arm64 future-proofing).
set -euo pipefail

VERSION="8.24.2"

case "$(uname -s)" in
  Linux)  OS=linux ;;
  Darwin) OS=darwin ;;
  *) printf 'install-gitleaks: unsupported OS: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) printf 'install-gitleaks: unsupported arch: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

tarball="gitleaks_${VERSION}_${OS}_${ARCH}.tar.gz"

# SHA-256 of each supported release tarball. Keep this table in sync
# with the official checksums.txt for the pinned VERSION above; any
# unlisted (OS, arch) combination is a hard error here so a silently
# unsupported runner cannot ship without review.
expected=""
case "${OS}_${ARCH}" in
  linux_x64)    expected="fa0500f6b7e41d28791ebc680f5dd9899cd42b58629218a5f041efa899151a8e" ;;
  linux_arm64)  expected="574a6d52573c61173add7ddb5e3cc68c0e82cb0735818a1eeb9a0a2de1643fbc" ;;
  darwin_x64)   expected="bc3c46f8039ba716ba8461fa6745c9d1cfb90ca2f5f881d8d0cf66b7ba7b742c" ;;
  darwin_arm64) expected="90d13686937ac7429b97a3acbf1e1d0ce90d92ae2d0cf46a690bd8ae5230bea0" ;;
  *) printf 'install-gitleaks: no pinned checksum for %s_%s; bump VERSION + update the case table.\n' "$OS" "$ARCH" >&2; exit 1 ;;
esac

url="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${tarball}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

printf 'install-gitleaks: downloading %s\n' "$url" >&2
curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$tmpdir/$tarball"

# `shasum -a 256` is present on both Linux and macOS runners; sha256sum
# is missing on stock macOS. Compare via shell so we do not need the
# coreutils-style `-c` flag.
actual="$(shasum -a 256 "$tmpdir/$tarball" | awk '{print $1}')"
if [ "$actual" != "$expected" ]; then
  printf 'install-gitleaks: checksum mismatch for %s\n  expected %s\n  actual   %s\n' "$tarball" "$expected" "$actual" >&2
  exit 1
fi
printf 'install-gitleaks: checksum verified (%s)\n' "$expected" >&2

dest="${GITLEAKS_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dest"
tar -xzf "$tmpdir/$tarball" -C "$dest" gitleaks
chmod +x "$dest/gitleaks"

# Expose the install dir to subsequent CI steps. Outside GHA this is a
# no-op so the script stays useful for local repro.
if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$dest" >> "$GITHUB_PATH"
fi

"$dest/gitleaks" version
