# EXP-09 doc-gate in practice
# CLAIM: 2026-06-10T06:00:00Z by Codex

## Hypothesis (frozen)
Doc validation gates block documentation violations at error level, while documentation warnings stay non-blocking. If we trigger a hard rule breach in a temporary file, the gate should fail deterministically with a clear message.

## Prediction
- If the repo is left in normal state, `doc-validator` emits baseline warnings only.
- Adding a file that violates the ADR schema (required frontmatter and filename shape) creates a hard validation error and blocks.
- The validator output should reference the broken rule and the exact path.

## Probe plan
1. Add a temporary violating document under a scratch folder.
2. Run `harness/doc-validator/bin/doc-validator` and capture whether exit code is non-zero.
3. Remove the scratch file and keep evidence of the gate output if it is reproducible.
4. Record the result and whether guidance is actionable.
