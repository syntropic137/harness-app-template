// sentrux_scan.mjs - sentrux adapter for the architectural-fitness gate.
//
// Activates sentrux as a SECOND architectural lens alongside APSS topology.
// Runs `sentrux gate <root> --save` to produce a fresh measurement file at
// `<root>/.sentrux/baseline.json`, parses the metrics, and emits a small
// JSON envelope on stdout that harness/sensors/gate.mjs consumes via the
// `--sentrux=<path>` flag.
//
// Wired per ADR-0017 (sentrux preserved as opt-in available adapter) and
// ADR-0006-sensors (Rust aggregator with swappable adapters; sentrux is
// the AI-governance overlay across 52 tree-sitter language plugins).
//
// Soft-skip contract — when the `sentrux` binary is not on PATH, when the
// scan errors, or when the produced baseline file is unreadable, we emit
// `{available: false, reason: "..."}` and exit 0. The gate then treats
// every sentrux metric as a no-reading rather than a false zero (mirrors
// the SC01/LG01 adapters in bin/sensors). Forks that want the overlay
// install the binary (see docs/standard/decisions/sensors.md for the
// install snippet); forks that don't get a clean skip.
//
// Cost note (timing): full-template scan on the bare scaffold runs at
// ~3.6 s wall-clock (sentrux v0.5.7 linux-x86_64, 380 git-tracked files).
// Too slow for pre-commit; runs alongside the existing CI sensors-gate
// step (the canonical ratchet authority per ADR-0020 / bead
// create-harness-app-n48.4).
//
// The `.sentrux/` directory the binary writes is already covered by the
// scaffolded .gitignore alongside `.apss/` and `.topology/`, so this
// adapter does not introduce repo churn even though every run rewrites
// `.sentrux/baseline.json`.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SENTRUX_BINARY = 'sentrux';

// Whitelist of fields lifted from sentrux's baseline.json into the
// envelope. Keep this narrow on purpose: only values whose direction is
// unambiguous (smaller-is-better counts + the composite quality signal)
// flow into the ratchet. Edge counts (total_import_edges,
// cross_module_edges) and the unix timestamp are intentionally dropped
// because their direction is undefined for a growing codebase.
const METRIC_FIELDS = [
  'quality_signal',
  'coupling_score',
  'cycle_count',
  'god_file_count',
  'hotspot_count',
  'complex_fn_count',
  'max_depth',
];

function commandExists(command, envPath = process.env.PATH ?? '') {
  if (!command) {
    return false;
  }
  if (command.includes('/') || isAbsolute(command)) {
    try {
      const stat = existsSync(command);
      return stat;
    } catch {
      return false;
    }
  }
  for (const dir of envPath.split(delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, command);
    if (existsSync(candidate)) {
      return true;
    }
  }
  return false;
}

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' || arg === '--workspace-root') {
      args.root = argv[i + 1] ?? args.root;
      i += 1;
    } else if (arg.startsWith('--root=')) {
      args.root = arg.slice('--root='.length);
    } else if (arg.startsWith('--workspace-root=')) {
      args.root = arg.slice('--workspace-root='.length);
    } else if (arg === '--binary') {
      args.binary = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--binary=')) {
      args.binary = arg.slice('--binary='.length);
    }
  }
  return args;
}

function unavailable(reason) {
  return {
    tool: 'sentrux',
    available: false,
    reason,
    metrics: {},
  };
}

function pickMetrics(parsed) {
  const out = {};
  for (const field of METRIC_FIELDS) {
    const value = parsed?.[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[field] = value;
    }
  }
  return out;
}

export function runSentrux(args, io = {}) {
  const root = resolve(args.root ?? process.cwd());
  const binary = args.binary ?? SENTRUX_BINARY;
  const exists = io.commandExists ?? commandExists;
  if (!exists(binary)) {
    return unavailable(`required command not found: ${binary}`);
  }
  const spawn = io.spawnSync ?? spawnSync;
  const result = spawn(binary, ['gate', root, '--save'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Sentrux's scan map of even a modest workspace pushes well past
    // node's default 1 MB stdout buffer; raise the ceiling so the pipe
    // does not truncate mid-trace and short-circuit our parse to "no
    // reading" on a successful scan.
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      // sentrux v0.5.x persists anonymous telemetry under XDG_DATA_HOME.
      // Pin it OFF here so the adapter is a pure read-only sensor inside
      // a CI/local gate run, mirroring the agentic-harness-lab patch
      // intent (patches/sentrux/001-disable-telemetry.patch). Operators
      // who want the upstream telemetry on can still flip it via
      // `sentrux analytics enable` outside the gate.
      SENTRUX_ANALYTICS: 'off',
    },
  });
  if (result.error) {
    return unavailable(`spawn failed: ${result.error.message}`);
  }
  if (typeof result.status !== 'number' || result.status !== 0) {
    return unavailable(
      `exited with status ${result.status ?? '?'} (stderr: ${(result.stderr ?? '')
        .toString()
        .trim()
        .slice(0, 200)})`,
    );
  }
  const baselinePath = join(root, '.sentrux', 'baseline.json');
  const fileExists = io.fileExists ?? existsSync;
  if (!fileExists(baselinePath)) {
    return unavailable(`baseline file not produced at ${baselinePath}`);
  }
  const readFile = io.readFile ?? ((p) => readFileSync(p, 'utf8'));
  let parsed;
  try {
    parsed = JSON.parse(readFile(baselinePath));
  } catch (err) {
    return unavailable(`baseline JSON unreadable: ${err.message}`);
  }
  const metrics = pickMetrics(parsed);
  if (Object.keys(metrics).length === 0) {
    return unavailable('baseline contained no recognized metric fields');
  }
  return {
    tool: 'sentrux',
    available: true,
    binary,
    root,
    baseline_path: baselinePath,
    metrics,
    raw: {
      timestamp: parsed?.timestamp ?? null,
      total_import_edges: parsed?.total_import_edges ?? null,
      cross_module_edges: parsed?.cross_module_edges ?? null,
    },
  };
}

/** True when this module is being executed directly (not imported).
 *  Resolves symlinks on both sides because the sensors slot is invoked
 *  via paths that ntm-style and proj-style setups symlink in from
 *  /data/projects/<org>--<repo> (see CLAUDE.md). Node resolves
 *  import.meta.url through realpath but leaves process.argv[1] as the
 *  symlinked path the shell passed, so a raw comparison fails and main()
 *  never runs - the sentrux envelope comes out empty and the gate
 *  silently drops every sentrux metric to no-reading. Mirrors the
 *  pattern aggregate.mjs / deadcode_scan.mjs already use.
 */
function isScriptEntry() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isScriptEntry()) {
  const args = parseArgs(process.argv.slice(2));
  const envelope = runSentrux(args);
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(0);
}
