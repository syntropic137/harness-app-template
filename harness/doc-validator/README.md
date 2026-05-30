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
