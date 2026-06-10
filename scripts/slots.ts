import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Minimal subset of harness.manifest.json needed to render the slot table.
// Re-declared locally instead of imported from `./lib/slots` so this script
// is a single-edge leaf (only node:fs and node:path). The full slot
// resolver lives in `./lib/slots`; this surface is presentation-only.
interface SlotRecord {
  plugin: string;
  version?: string;
  required: boolean;
  decisionAt?: string;
}

interface ManifestShape {
  name?: string;
  version?: string;
  slots?: Record<string, SlotRecord>;
}

export interface SlotsDeps {
  cwd: string;
  readText: (path: string) => string;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exit: (code: number) => never;
  argv: string[];
}

export interface SlotRow {
  slot: string;
  plugin: string;
  version: string;
  required: string;
  adr: string;
}

const HEADERS: SlotRow = {
  slot: 'slot',
  plugin: 'plugin',
  version: 'version',
  required: 'required',
  adr: 'ADR',
};

export function rowsFromManifest(slots: Record<string, SlotRecord>): SlotRow[] {
  return Object.entries(slots).map(([name, slot]) => ({
    slot: name,
    plugin: slot.plugin,
    version: slot.version ?? '',
    required: slot.required ? 'yes' : 'no',
    adr: shortAdr(slot.decisionAt),
  }));
}

function shortAdr(decisionAt: string | undefined): string {
  if (!decisionAt) return '';
  const slashIndex = decisionAt.lastIndexOf('/');
  const tail = slashIndex >= 0 ? decisionAt.slice(slashIndex + 1) : decisionAt;
  const match = /^(ADR-\d+)/i.exec(tail);
  // match[1] is guaranteed defined whenever the regex matches (single capture).
  return match ? (match[1] as string) : tail;
}

function widthOf(rows: SlotRow[], field: keyof SlotRow): number {
  return Math.max(HEADERS[field].length, ...rows.map((r) => r[field].length));
}

function renderRow(r: SlotRow, widths: Record<keyof SlotRow, number>): string {
  return `  ${r.slot.padEnd(widths.slot)}  ${r.plugin.padEnd(widths.plugin)}  ${r.version.padEnd(widths.version)}  ${r.required.padEnd(widths.required)}  ${r.adr.padEnd(widths.adr)}`.trimEnd();
}

export function renderTable(rows: SlotRow[]): string[] {
  const widths: Record<keyof SlotRow, number> = {
    slot: widthOf(rows, 'slot'),
    plugin: widthOf(rows, 'plugin'),
    version: widthOf(rows, 'version'),
    required: widthOf(rows, 'required'),
    adr: widthOf(rows, 'adr'),
  };
  const header = renderRow(HEADERS, widths);
  const ruler = `  ${'-'.repeat(widths.slot)}  ${'-'.repeat(widths.plugin)}  ${'-'.repeat(widths.version)}  ${'-'.repeat(widths.required)}  ${'-'.repeat(widths.adr)}`;
  return [header, ruler, ...rows.map((r) => renderRow(r, widths))];
}

function readManifest(cwd: string, readText: (path: string) => string): ManifestShape {
  const path = join(cwd, 'harness.manifest.json');
  try {
    return JSON.parse(readText(path)) as ManifestShape;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid JSON: ${message}`);
  }
}

export function main(deps: SlotsDeps): void {
  const wantsJson = deps.argv.includes('--json');
  let manifest: ManifestShape;
  try {
    manifest = readManifest(deps.cwd, deps.readText);
  } catch (error) {
    // readManifest always wraps thrown values in an Error.
    deps.stderr.error((error as Error).message);
    deps.exit(1);
    return;
  }
  const slots = manifest.slots ?? {};
  const rows = rowsFromManifest(slots);

  if (wantsJson) {
    deps.stdout.log(JSON.stringify({ slots: rows }, null, 2));
    return;
  }

  const headline =
    manifest.name && manifest.version
      ? `Harness composition for ${manifest.name} v${manifest.version} (read from harness.manifest.json):`
      : 'Harness composition (read from harness.manifest.json):';
  deps.stdout.log(headline);
  deps.stdout.log('');
  for (const line of renderTable(rows)) {
    deps.stdout.log(line);
  }
  deps.stdout.log('');
  deps.stdout.log(
    'To swap a plugin: edit harness.manifest.json (slots.<name>.plugin) and run `just bootstrap`.',
  );
  deps.stdout.log(
    'See docs/slot-contracts.md for the slot interface contract and a worked swap example.',
  );
}

/* v8 ignore next 12 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main({
    cwd: process.cwd(),
    readText: (path: string) => readFileSync(path, 'utf8'),
    stdout: console,
    stderr: console,
    exit: (code: number): never => process.exit(code),
    argv: process.argv.slice(2),
  });
}
