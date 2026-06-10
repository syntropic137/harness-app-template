# harness/doc-validator

Rust implementation of the `doc-validator` slot.

It enforces the phase-1 documentation contract:

- Markdown relative links and anchors resolve.
- ADRs under `docs/adrs/` follow APSS ADR01 shape.
- `harness.manifest.json#slots.*.decisionAt` points at existing ADR files.
- Harness-engineering principle docs exist and stay link-valid.

Run it from the repo root:

```sh
harness/doc-validator/bin/doc-validator .
```

## Composition with APS-V1-0003 at pre-commit

Per [ADR-0018](../../docs/adrs/ADR-0018-apss-v1-1-0-augmentation.md)
this slot enforces ADR shape, internal links, and manifest cross-refs;
the packaged APSS APS-V1-0003 documentation standard runs as an
ADDITIONAL gate at pre-commit (via `scripts/doc-validator.mjs --apss`,
which shells out to the project's `.apss/bin/apss` composed by
`scripts/bootstrap.ts ensureApssBinary`). Both gates must pass. APS-V1-0003
adds docs-wide structural rules (per-Markdown front matter, per-directory
README index, per-directory AGENTS.md / CLAUDE.md, `.apss/config.toml`,
plus the ADR01 substandard which is a strict superset of the rule above).
Neither gate replaces the other; ADR-0010's pick remains authoritative
for this slot's PRIMARY decisionAt.
