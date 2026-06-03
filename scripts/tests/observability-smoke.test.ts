import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync('harness/observability/smoke.sh', 'utf8');

describe('observability smoke script plan', () => {
  it('runs the TypeScript, Rust, and Python examples', () => {
    expect(script).toContain('pnpm --filter @example/typescript emit');
    expect(script).toContain(
      'cargo run --quiet --manifest-path "$ROOT/ws_apps/example-rust/Cargo.toml"',
    );
    expect(script).toContain('uv run --project "$ROOT/ws_apps/example-python" example-python');
  });

  it('uses stack-manager allocated ports and queries both backends', () => {
    expect(script).toContain('OTEL_OTLP_PORT="$(printf');
    expect(script).toContain('VL_PORT="$(printf');
    expect(script).toContain('VT_PORT="$(printf');
    expect(script).toContain('/select/logsql/query');
    expect(script).toContain('/select/jaeger/api/traces');
  });
});
