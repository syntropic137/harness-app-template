# EXP-01 fork-bootstrap
# CLAIM: 2026-06-10T00:00:00Z by Codex

## Hypothesis (frozen)
On a clean checkout, `just bootstrap` completes successfully and the first trivial documentation commit passes APSS doc gate without emitting "APSS binary not found".

## Prediction
The bootstrap command will complete end-to-end and a minimal Markdown doc change will be accepted by doc validation as a non-blocking operation.

## Probe plan (pre-commit)
1. Clone a clean checkout into a temporary worktree and run `just bootstrap`.
2. Create one trivial documentation-only commit in that clean clone.
3. Run APSS/doc validation gates used for docs.
4. Record exact command output and gate message behavior.
