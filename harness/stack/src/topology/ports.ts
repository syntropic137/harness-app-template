export const PORT_SERVICES = [
  'WEB_PORT',
  'API_PORT',
  'PG_PORT',
  'VL_PORT',
  'VM_PORT',
  'VT_PORT',
  'OTEL_OTLP_PORT',
  'API_RUST_PORT',
  'API_PY_PORT',
  'API_CPP_PORT',
] as const;

export type PortName = (typeof PORT_SERVICES)[number];
export type PortMap = Record<PortName, number>;

export function allocatePorts(isoKey: string): PortMap {
  const base = 30000 + (parseInt(isoKey, 16) % 1000) * 10;
  const out = {} as PortMap;
  PORT_SERVICES.forEach((name, i) => {
    out[name] = base + i;
  });
  return out;
}
