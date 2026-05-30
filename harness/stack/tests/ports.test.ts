import { describe, expect, it } from 'vitest';
import { allocatePorts, PORT_SERVICES } from '../src/topology/ports.js';

describe('allocatePorts', () => {
  it('returns deterministic ports for a given isoKey', () => {
    const a = allocatePorts('a3f2c1b9');
    const b = allocatePorts('a3f2c1b9');
    expect(a).toEqual(b);
  });
  it('all ten services get distinct ports', () => {
    const p = allocatePorts('a3f2c1b9');
    const values = Object.values(p);
    expect(new Set(values).size).toBe(values.length);
    expect(values.length).toBe(PORT_SERVICES.length);
  });
  it('base is in 30000-39999 and 10-aligned', () => {
    const p = allocatePorts('a3f2c1b9');
    expect(p.WEB_PORT).toBeGreaterThanOrEqual(30000);
    expect(p.WEB_PORT).toBeLessThan(40000);
    expect(p.WEB_PORT % 10).toBe(0);
  });
  it('exposes service offset map matching PORT_SERVICES', () => {
    const p = allocatePorts('00000001');
    expect(p.API_PORT - p.WEB_PORT).toBe(1);
    expect(p.PG_PORT - p.WEB_PORT).toBe(2);
    expect(p.VL_PORT - p.WEB_PORT).toBe(3);
    expect(p.VM_PORT - p.WEB_PORT).toBe(4);
    expect(p.VT_PORT - p.WEB_PORT).toBe(5);
    expect(p.OTEL_OTLP_PORT - p.WEB_PORT).toBe(6);
    expect(p.API_RUST_PORT - p.WEB_PORT).toBe(7);
    expect(p.API_PY_PORT - p.WEB_PORT).toBe(8);
    expect(p.API_CPP_PORT - p.WEB_PORT).toBe(9);
  });
});
