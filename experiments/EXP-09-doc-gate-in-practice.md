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

## Probe results

- `docs/adrs/EXP-09-BAD.md` created with body only, no ADR-style filename and no YAML frontmatter.
- `harness/doc-validator/bin/doc-validator .` returned `EXIT:1` while the file existed.
- Reported errors were:
  - `ADR filename must match ADR-NNNN-kebab-case-title.md`
  - `ADR missing YAML front matter`
- `rm docs/adrs/EXP-09-BAD.md` then rerun `doc-validator .` returned `BASE_EXIT:0`.
- After cleanup, validator output was clean: `✓ doc-validator: 248 internal links across 517 markdown links, ADRs, manifest decisions, and principle docs all validate`.

## Verdict
- Result: **CONFIRMED**.
- The gate blocks hard contract violations with non-zero exit and actionable path/rule output.
- Warnings-only behavior could not be reproduced from this branch in the tested probe; baseline run after cleanup passed cleanly.

## Reusable empirical claims
- Hard `doc-validator` violations in ADR shape are blocking in this harness (`exit 1`).
- One temporary malformed ADR file is sufficient to flip outcome from `BASE_EXIT:0` to `EXIT:1`.
- Error output maps directly to file path and checker rule names, making guided repair possible.
