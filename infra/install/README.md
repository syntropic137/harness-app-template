# infra/install

Idempotent install scripts that pair with `infra/doctor/` probes.

| Doctor reports state | Install attempts to fix |
|---|---|
| `infra/doctor/cpp-unreal.yaml` | `infra/install/cpp-unreal.sh` |

The two are intentionally separate. Per EXP-26's verdict, `harness doctor` is read-only — it never modifies state. The install scripts are opt-in: you choose to run them, they prompt for sudo where needed.

## Usage

```sh
# Preview what would run (no changes):
bash infra/install/cpp-unreal.sh --dry-run

# Run for real (prompts for sudo on Xcode license + opentelemetry-cpp install):
bash infra/install/cpp-unreal.sh
```

## Idempotency

Every step checks "already done?" before acting. Safe to re-run any number of times:

- `brew install X` — no-op if already installed (brew is idempotent by design)
- `xcode-select -s` — no-op if the active developer dir already points at Xcode.app
- `xcodebuild -license accept` — no-op if license already accepted
- `git lfs install --skip-repo` — guarded by checking `git config filter.lfs.clean`
- opentelemetry-cpp build — guarded by checking for the installed version header

Steps that **require human action** (Xcode install via Mac App Store, UE install via Epic Games Launcher) exit early with clear next-step instructions. Re-run the script after completing the manual step to continue.

## Pairing with doctor

Workflow:

```sh
pnpm harness doctor cpp-unreal      # see what's missing
bash infra/install/cpp-unreal.sh    # install what can be scripted
# (do any manual steps the script printed)
bash infra/install/cpp-unreal.sh    # re-run; verify progress
pnpm harness doctor cpp-unreal      # final check — should be all green
```

When the doctor probe returns 0 failures, the env is ready for the experiment (EXP-22 in cpp-unreal's case).

## Adding a new install script

1. Confirm the corresponding probe exists in `infra/doctor/<lang>.yaml`.
2. Write `infra/install/<lang>.sh` (or `.mjs` if cross-platform — bash is fine for Mac/Linux-only).
3. Each step:
   - Check "already done?" — emit `✓` and skip if so
   - Otherwise emit `→` and run the install command
   - Support `--dry-run` (gate every state-mutating command behind the `run` helper)
4. End the script with `pnpm harness doctor <lang>` to verify.

## Why not auto-fix in `harness doctor`?

The `doctor` command is intentionally read-only. Three reasons:

1. **Predictability** — `doctor` outputs the same shape whether or not you'd ever run an install. Easy to embed in CI gates, agent prompts, status dashboards.
2. **Safety** — installing Xcode requires GUI auth; brew commands prompt for sudo; opentelemetry-cpp takes 30–60 min to compile. None of these belong inside a "show me the state" command.
3. **Separation of concerns** — same shape as `kubectl get` vs `kubectl apply`. The probe and the fix are different operations.
