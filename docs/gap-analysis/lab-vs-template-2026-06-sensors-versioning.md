# Lab vs Template Gap Analysis: Sensors Fitness Functions and Versioning

Date: 2026-06-02

Template repo: `/data/projects/harness-app-template`

Lab repo: `/data/projects/NeuralEmpowerment--agentic-harness-lab`

Scope: sensors fitness functions under `harness/sensors` and the `harness/versioning` slot.

## Verdict

The template is ahead of the lab on the APSS fitness gate itself. The template has an 8-dimension APSS baseline with 6 enforced dimensions: MT01, MD01, ST01, SC01, LG01, and PF01. AC01 and AV01 are advisory by design.

The lab still has two sensor capabilities the template is missing:

1. A governance TOML policy engine with `constraints`, `per_sensor`, `ignore`, `exclude`, severity handling, replay input, and JSON gate output.
2. A sensor adapter seam with a stable `Reading` schema, `Sensor` trait, applicability prechecks, workspace package fanout, `skip-tier`, and optional sentrux and grimp adapters. The external plugin protocol is documented in the lab as draft, while the internal adapter seam is implemented.

The versioning slot is at parity or better in the template. The template retains the lab's whole-repo changelog check shape and adds commit-range validation, release planning, release application, manifest version bumping, local wrappers, and a dedicated GitHub Actions versioning workflow. No versioning bead was filed.

## Sources Checked

Template sensors:

- `harness/sensors/gate.mjs:35-86` defines all 8 APSS dimensions and marks MT01, MD01, ST01, SC01, LG01, and PF01 as enforced.
- `harness/sensors/gate.mjs:88-260` defines objective metrics, sources, directions, thresholds, and fail-on-regression behavior.
- `harness/sensors/baseline.json:43-225` records objective metadata and baselines for all 8 dimensions.
- `harness/sensors/bin/sensors:43-171` hard-codes the Node pipeline and gate flags.
- `harness/.harness/governance.toml:18-36` has a lab-style policy seed, but template sensor code does not consume it.
- `.github/workflows/test.yml:23-40` runs the APSS and perf fitness gates under Node 20.

Lab sensors:

- `harness/sensors/src/policy.rs:25-53` defines the policy schema.
- `harness/sensors/src/aggregator.rs:51-109` evaluates readings against policy and returns violations.
- `harness/sensors/src/cli.rs:62-99` exposes gate options for workspace root, policy path, JSON output, readings replay, and skip-tier.
- `harness/sensors/src/cli.rs:139-253` loads policy, gathers readings, filters exclusions, synthesizes metrics, evaluates violations, and emits text or JSON.
- `harness/sensors/src/sensor.rs:13-130` defines `Reading`, `Scope`, `Unit`, `ScanOpts`, `Applicability`, and `Sensor`.
- `harness/sensors/src/cli.rs:256-348` implements precheck, missing-dependency handling, skip-tier, and package fanout.
- `harness/sensors/src/adapters/sentrux.rs:37-240` parses patched sentrux readings and root-cause scores.
- `harness/sensors/src/adapters/grimp_instability.rs:1-139` emits Python Martin Ca, Ce, and instability readings.
- `harness/sensors/docs/plugin-protocol.md:5-95` documents the draft external plugin protocol.

Versioning:

- Lab `harness/versioning/src/lib.rs:17-76` supports `check --mode whole-repo` and a warning no-op `per-package` mode.
- Lab `lefthook.yml:197-207` runs the current version to changelog check when `harness-versioning` is installed.
- Template `harness/versioning/src/lib.rs:24-82` adds `check`, `ci-check`, `plan`, and `release`.
- Template `harness/versioning/src/lib.rs:180-248` validates commit ranges and applies release commits and tags.
- Template `justfile:51-64` exposes versioning and release recipes.
- Template `lefthook.yml:133-165` mirrors release-check locally.
- Template `.github/workflows/versioning.yml:1-67` tests the slot, gates PR and main, and applies releases by workflow dispatch.

## Gap 1: Governance Policy Engine

What the lab has:

- `Policy` supports project constraints, per-sensor rules, ignore exemptions, and exclude suppression.
- Thresholds carry value, comparison direction, and severity.
- `evaluate()` returns structured `Violation` records.
- The gate fails only on error-severity violations; warn-severity findings are reported but pass.
- `--readings-from` can replay a captured JSON readings file against a policy.
- `--format json` emits `{ readings, violations, exit_code }`, which is useful for CI parsers and agents.
- Tests cover empty policy, missing policy, failing policy, warn-only policy, replay, JSON output, exclude filtering, and fanout.

What the template has:

- `harness/.harness/governance.toml` exists and contains lab-style constraints.
- `harness/sensors/gate.mjs` does not parse TOML and does not evaluate constraints or per-sensor rules.
- `harness/sensors/bin/sensors gate` accepts only `--update-baseline`, `--baseline`, and `--first-run-mode` before delegating to `gate.mjs`.
- `baseline.json` is the active policy surface. It compares objective APSS metrics against stored baselines, not arbitrary governance TOML thresholds.

Conformance impact:

The template enforces six APSS dimensions, but it cannot yet consume the lab's policy file shape. The seeded `harness/.harness/governance.toml` is documentation until this gap is closed.

Filed bead: `create-harness-app-sensors-governance-policy-parity-4vt`.

## Gap 2: Adapter Seam and Optional Adapters

What the lab has:

- A typed `Sensor` trait and `Reading` schema.
- `Applicability` states for applicable, not applicable, and missing dependency.
- Workspace package detection for JS and Python monorepos.
- Per-package fanout and workspace-relative path qualification.
- `--workspace-root` and `--skip-tier` operational controls.
- Implemented adapters for `basic-project`, `dep-cruiser`, `ts-morph-abstractness`, `sentrux`, and `grimp-instability`.
- A draft external plugin protocol for executable adapters named `harness-adapter-*`.

What the template has:

- A working Node dispatcher with hard-coded adapters for dependency-cruiser, ts-morph abstractness, ts-morph complexity, APSS topology, UBS security, license scan, and perf baseline.
- No `--workspace-root` on `gate`.
- No typed adapter API, precheck protocol, or missing-dependency classification beyond command guards inside the shell script.
- No monorepo package fanout API outside the existing fixed `ws_apps` and `ws_packages` globs.
- No sentrux or grimp entrypoint, even though ADR-0017 preserves sentrux and per-language adapters as available rather than retired.
- No external plugin discovery. The lab's external protocol is draft documentation, not implemented code, so the real port target can be either the lab's internal adapter API or a stabilized external protocol.

Conformance impact:

The template preserves APSS as canonical, which is correct. The missing piece is the adapter seam that lets optional lab adapters coexist with APSS without editing the fixed shell pipeline.

Filed bead: `create-harness-app-sensors-adapter-seam-parity-lhz`.

## Not Counted as Gaps

The lab does not have a better APSS 8-dimension gate than the current template. The template is ahead on enforced APSS fitness behavior.

The lab's external plugin protocol is a draft experiment document. I counted the adapter seam as a gap because the lab implements the internal `Sensor` trait, precheck, fanout, and optional adapter behavior. I did not claim that external plugin discovery is already implemented in lab code.

The template sensors README still describes ST01, SC01, LG01, and PF01 as advisory in one section even though `gate.mjs` and `baseline.json` mark them active and enforced. That is template doc drift, not a lab-vs-template missing capability, so I did not file a lab-gap bead for it.

## Versioning Parity

Lab versioning implements the original slot minimum:

- Detect version from `Cargo.toml`, `package.json`, or `pyproject.toml`.
- Confirm the current version has a `CHANGELOG.md` entry.
- Expose `whole-repo` and `per-package` modes, with `per-package` warning and succeeding.
- Wire a pre-push changelog sync check when `harness-versioning` is installed.

Template versioning is at parity and ahead:

- It keeps `check --mode whole-repo` and the `per-package` no-op warning.
- It adds commit-range validation and non-conventional commit rejection.
- It adds `ci-check`, `plan`, and `release`.
- Release apply updates `CHANGELOG.md`, updates the top-level `harness.manifest.json` version, commits, and tags.
- It ships a local `harness/versioning/bin/versioning` wrapper and `@harness/versioning` package metadata for the template workspace.
- It has local `just release-*` recipes, pre-push release-check, and a dedicated GitHub Actions versioning workflow.

The lab `harness/versioning/Cargo.toml` has `package.metadata.binstall`; the template crate omits it because the template slot is a local scaffolded workspace package with a local wrapper and release workflow. That is distribution polish, not a versioning slot behavior gap.

No versioning bead filed.

## Filed Beads

| Bead | Gap |
| --- | --- |
| `create-harness-app-sensors-governance-policy-parity-4vt` | Make the template sensors gate consume lab-style governance TOML policy, replay readings, and emit JSON violations |
| `create-harness-app-sensors-adapter-seam-parity-lhz` | Expose a lab-style adapter seam with precheck, workspace-root, package fanout, skip-tier, and optional sentrux/grimp adapters |
