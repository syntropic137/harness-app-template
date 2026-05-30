# Pre-flight checklist

Run BEFORE writing the hypothesis. Each item resolves a confound that has bitten prior experiments. Source: `experiments/_template/README.md` and the lessons that hardened it (record yours under `docs/retrospectives/` as you accumulate them).

## 1. Working tree is clean for the files the experiment depends on

`git status --short` and audit. If a relevant source file shows `M`, either commit the change, `git checkout HEAD -- <file>` to reset, or explicitly document it as part of Setup (it's now a confound). Working-tree drift can turn a real signal into a false-bug investigation that costs minutes-to-hours.

## 2. Stack is in a known state

If the experiment requires a fresh stack: `just stack destroy` first (then `just stack boot` for the run). If it requires baseline traffic, seed it before measuring. Don't measure against a stack whose state evolved across other experiments.

## 3. Artifacts directory is clean for the iso_key under test

Pre-existing `.harness/artifacts/<iso>/` files from prior runs can confuse subagents that read them expecting fresh state.

## 4. Tool versions documented

If the experiment depends on a specific version of a tool (Playwright, ffmpeg, Rust, Node, Bun, …), note the version in the Setup section so the experiment is reproducible across time.

## 5. Conventions cited; marketing claims separated

If your hypothesis references a marketing claim from a tool's docs ("saves 60–90% tokens"), treat that as a WORKLOAD average and predict your specific commands separately. Aggregate ≠ per-command.

## 6. Baseline captured before any change

Without a recorded baseline, "after" numbers are anecdotes. The baseline goes into `runs/baseline-*` and is referenced from `results.md` as the comparison anchor. This is the harness-engineering analog of the AI-pilot "before/after snapshot" pattern: the baseline is what lets impact be measured, not assumed.
