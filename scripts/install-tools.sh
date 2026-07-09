#!/usr/bin/env bash
# just install-tools — one-command setup of the OPTIONAL local harness adapter
# tools on a fresh clone, so the git hooks and the strict fitness gate run
# locally (bugs caught on commit, CI as the backstop).
#
# Installs, idempotently (skips anything already present, never hard-fails on a
# single tool):
#   - UBS (Ultimate Bug Scanner)  -> SC01 security adapter + ubs-staged/ubs-diff hooks
#   - sentrux                     -> 2nd architectural lens (Linux x86_64 only today)
#   - runtime deps: ast-grep, ripgrep, jq, hyperfine, and (macOS) bash >= 4
#
# The pinned + checksum-verified tool installers live in .github/scripts/
# (install-ubs.sh, install-sentrux.sh) and are reused here so there is ONE
# pinned source of truth shared by CI and local dev.
#
# Core toolchain (bun, pnpm, cargo, uv, just, docker) is NOT handled here —
# run `just doctor` for that; it prints per-tool install hints.
set -uo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
installed=()
skipped=()
failed=()

have() { command -v "$1" >/dev/null 2>&1; }

# Resolve an OS package-manager install command for a dep, or empty if none.
pkg_install() {
  local pkg="$1"
  if have brew; then
    printf 'brew install %s' "$pkg"
  elif have apt-get; then
    printf 'sudo apt-get install -y -qq %s' "$pkg"
  else
    printf ''
  fi
}

ensure_dep() {
  local bin="$1" pkg="$2"
  if have "$bin"; then
    skipped+=("$bin (already present)")
    return 0
  fi
  local cmd
  cmd="$(pkg_install "$pkg")"
  if [ -z "$cmd" ]; then
    failed+=("$bin (no brew/apt found — install $pkg manually)")
    return 1
  fi
  printf 'install-tools: installing %s (%s)\n' "$bin" "$cmd" >&2
  if eval "$cmd" >&2; then
    installed+=("$bin")
  else
    failed+=("$bin (\`$cmd\` failed)")
  fi
}

os="$(uname -s)"
arch="$(uname -m)"

# --- runtime deps for the UBS scanner + perf bench ---
# macOS ships bash 3.2; UBS needs >= 4. A plain presence check is not enough
# (`command -v bash` finds the old /bin/bash), so check the VERSION of the bash
# on PATH and install a modern one via brew when it is <4. brew bash installs
# 5.x to /opt/homebrew/bin (ensure it precedes /bin on PATH).
if [ "$os" = "Darwin" ]; then
  bash_major="$(bash -c 'echo "${BASH_VERSINFO[0]:-0}"' 2>/dev/null || echo 0)"
  if [ "${bash_major:-0}" -ge 4 ]; then
    skipped+=("bash (>=4 already present)")
  elif have brew; then
    printf 'install-tools: installing bash >=4 (brew install bash; system bash is %s)\n' \
      "${bash_major:-unknown}" >&2
    if brew install bash >&2; then
      installed+=("bash")
    else
      failed+=("bash (\`brew install bash\` failed)")
    fi
  else
    failed+=("bash (system bash is <4 and no brew found — install bash >=4 manually)")
  fi
fi
ensure_dep ast-grep ast-grep
ensure_dep rg ripgrep
ensure_dep jq jq
ensure_dep hyperfine hyperfine

# --- UBS (pinned, checksum-verified; cross-platform single bash script) ---
if have ubs; then
  skipped+=("ubs (already present)")
else
  printf 'install-tools: installing UBS via .github/scripts/install-ubs.sh\n' >&2
  if bash "$repo_root/.github/scripts/install-ubs.sh"; then
    installed+=("ubs")
  else
    failed+=("ubs (install-ubs.sh failed)")
  fi
fi

# --- sentrux (pinned; only linux-x86_64 has a pinned checksum today) ---
if have sentrux; then
  skipped+=("sentrux (already present)")
elif [ "$os" = "Linux" ] && { [ "$arch" = "x86_64" ] || [ "$arch" = "amd64" ]; }; then
  printf 'install-tools: installing sentrux via .github/scripts/install-sentrux.sh\n' >&2
  if bash "$repo_root/.github/scripts/install-sentrux.sh"; then
    installed+=("sentrux")
  else
    failed+=("sentrux (install-sentrux.sh failed)")
  fi
else
  skipped+=("sentrux (no pinned checksum for ${os}/${arch} — see harness/sensors/README.md)")
fi

# --- summary ---
printf '\n== install-tools summary ==\n' >&2
[ ${#installed[@]} -gt 0 ] && printf '  installed: %s\n' "${installed[*]}" >&2
[ ${#skipped[@]} -gt 0 ] && printf '  skipped:   %s\n' "${skipped[*]}" >&2
[ ${#failed[@]} -gt 0 ] && printf '  FAILED:    %s\n' "${failed[*]}" >&2

case ":$PATH:" in
  *":$HOME/.local/bin:"*) : ;;
  *) printf '\n  NOTE: add ~/.local/bin to your PATH (UBS/sentrux install there).\n' >&2 ;;
esac

# Fail only if a tool genuinely could not be installed, so CI/setup surfaces it.
[ ${#failed[@]} -eq 0 ]
