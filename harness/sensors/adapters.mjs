// adapters.mjs - internal sensor adapter seam for the sensors slot.
//
// The template keeps APSS and the existing Node adapters as the default gate.
// This module exposes the lab lineage as a small JS contract: adapter identity,
// applicability precheck, workspace package fanout, skip-tier matching, and
// optional sentrux / grimp entrypoints that fail soft when their tools are not
// installed.

import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_VERSION = 1;

export const BUILTIN_ADAPTERS = [
  {
    name: 'dep-cruiser',
    sensor: 'dep-cruiser@17.4.0',
    tier: 'tier-2',
    command: 'npx',
    fanout: true,
    shape: 'js',
  },
  {
    name: 'ts-morph-abstractness',
    sensor: 'ts-morph@23.0.0',
    tier: 'tier-2',
    command: 'node',
    fanout: true,
    shape: 'js',
  },
  {
    name: 'ts-morph-complexity',
    sensor: 'ts-morph-complexity',
    tier: 'tier-2',
    command: 'node',
    fanout: true,
    shape: 'js',
  },
  {
    name: 'apss-topology',
    sensor: 'apss-topology',
    tier: 'tier-1',
    command: 'node',
    fanout: false,
    shape: 'apss',
  },
  {
    name: 'sentrux',
    sensor: 'sentrux@optional',
    tier: 'optional',
    command: 'sentrux',
    fanout: false,
    shape: 'any',
    optional: true,
  },
  {
    name: 'grimp-instability',
    sensor: 'grimp-instability@optional',
    tier: 'optional',
    command: 'python3',
    fanout: true,
    shape: 'python',
    optional: true,
  },
];

const PACKAGE_MARKERS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
const PACKAGE_ROOTS = ['ws_apps', 'ws_packages', 'apps', 'packages', 'libs', 'services'];
const EXCLUDED_DIRS = new Set([
  '.git',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

export function parseSkipTier(values = []) {
  const parts = Array.isArray(values) ? values : [values];
  return new Set(
    parts
      .flatMap((value) => String(value ?? '').split(','))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function adapterBaseName(name) {
  return String(name).split('@')[0];
}

export function adapterSkipped(name, skipTier) {
  const base = adapterBaseName(name);
  for (const skip of skipTier ?? []) {
    if (skip === name || skip === base || name.startsWith(`${skip}@`)) {
      return true;
    }
  }
  return false;
}

export function commandExists(command, envPath = process.env.PATH ?? '') {
  if (!command) {
    return false;
  }
  if (command.includes('/') || isAbsolute(command)) {
    return isExecutable(command);
  }
  for (const dir of envPath.split(delimiter)) {
    if (dir && isExecutable(join(dir, command))) {
      return true;
    }
  }
  return false;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasAnyPackageMarker(dir) {
  return PACKAGE_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

function packageName(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (typeof parsed.name === 'string' && parsed.name.length > 0) {
      return parsed.name;
    }
  } catch {
    // Fall through to other manifests.
  }
  try {
    const pyproject = readFileSync(join(dir, 'pyproject.toml'), 'utf8');
    const match = pyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Fall through to Cargo.
  }
  try {
    const cargo = readFileSync(join(dir, 'Cargo.toml'), 'utf8');
    const match = cargo.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Fall through to directory name.
  }
  return basename(dir);
}

function shouldSkipDir(path, depth) {
  const name = basename(path);
  return EXCLUDED_DIRS.has(name) || (depth > 0 && name.startsWith('.'));
}

function walkPackages(dir, depth, seen, out) {
  if (depth > 3 || shouldSkipDir(dir, depth)) {
    return;
  }
  if (hasAnyPackageMarker(dir)) {
    const resolved = resolve(dir);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      out.push({ name: packageName(resolved), path: resolved });
    }
    return;
  }
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = join(dir, entry);
    try {
      if (statSync(child).isDirectory()) {
        walkPackages(child, depth + 1, seen, out);
      }
    } catch {
      // Ignore disappearing paths.
    }
  }
}

export function detectWorkspacePackages(root) {
  const workspaceRoot = resolve(root);
  const seen = new Set();
  const out = [];
  for (const segment of PACKAGE_ROOTS) {
    const dir = join(workspaceRoot, segment);
    if (existsSync(dir)) {
      walkPackages(dir, 0, seen, out);
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function packageHasShape(pkg, shape) {
  if (shape === 'any') {
    return true;
  }
  if (shape === 'js') {
    return existsSync(join(pkg.path, 'package.json'));
  }
  if (shape === 'python') {
    return existsSync(join(pkg.path, 'pyproject.toml'));
  }
  return false;
}

function adapterDefinition(name) {
  return BUILTIN_ADAPTERS.find((adapter) => adapter.name === name || adapter.sensor === name);
}

export function precheckAdapter(adapter, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const skipTier = options.skipTier ?? new Set();
  const packages = options.packages ?? detectWorkspacePackages(root);
  const commandCheck = options.commandExists ?? commandExists;

  if (adapterSkipped(adapter.name, skipTier) || adapterSkipped(adapter.sensor, skipTier)) {
    return {
      adapter: adapter.name,
      sensor: adapter.sensor,
      applicability: 'skipped',
      reason: 'skipped by --skip-tier',
      packages: [],
    };
  }
  if (!commandCheck(adapter.command)) {
    return {
      adapter: adapter.name,
      sensor: adapter.sensor,
      applicability: 'missing_dep',
      reason: `required command not found: ${adapter.command}`,
      packages: [],
    };
  }
  if (adapter.shape === 'apss') {
    const metricsDir = join(root, '.topology', 'metrics');
    return existsSync(metricsDir)
      ? {
          adapter: adapter.name,
          sensor: adapter.sensor,
          applicability: 'applicable',
          reason: 'APSS topology metrics found',
          packages: [],
        }
      : {
          adapter: adapter.name,
          sensor: adapter.sensor,
          applicability: 'not_applicable',
          reason: 'no .topology/metrics directory',
          packages: [],
        };
  }

  const matchingPackages = packages.filter((pkg) => packageHasShape(pkg, adapter.shape));
  if (adapter.fanout && matchingPackages.length > 0) {
    return {
      adapter: adapter.name,
      sensor: adapter.sensor,
      applicability: 'applicable',
      reason: `will fan out to ${matchingPackages.length} package(s)`,
      packages: matchingPackages,
    };
  }
  if (!adapter.fanout && (adapter.shape === 'any' || hasAnyPackageMarker(root))) {
    return {
      adapter: adapter.name,
      sensor: adapter.sensor,
      applicability: 'applicable',
      reason: 'workspace root applies',
      packages: [],
    };
  }
  return {
    adapter: adapter.name,
    sensor: adapter.sensor,
    applicability: 'not_applicable',
    reason: `no ${adapter.shape} package shape found`,
    packages: [],
  };
}

export function adapterManifest(root, skipTier = new Set(), options = {}) {
  const workspaceRoot = resolve(root);
  const packages = detectWorkspacePackages(workspaceRoot);
  const commandCheck = options.commandExists ?? commandExists;
  return {
    protocol_version: PROTOCOL_VERSION,
    workspace_root: workspaceRoot,
    packages,
    adapters: BUILTIN_ADAPTERS.map((adapter) =>
      precheckAdapter(adapter, {
        root: workspaceRoot,
        skipTier,
        packages,
        commandExists: commandCheck,
      }),
    ),
  };
}

export function qualifyScopePath(packagePrefix, path) {
  if (!packagePrefix || !path) {
    return path || packagePrefix;
  }
  const prefixBase = basename(packagePrefix);
  if (path === prefixBase) {
    return packagePrefix;
  }
  if (path.startsWith(`${prefixBase}/`)) {
    return `${packagePrefix}/${path.slice(prefixBase.length + 1)}`;
  }
  return `${packagePrefix}/${path}`;
}

export function qualifyReadings(readings, packagePrefix) {
  return readings.map((reading) => {
    const scope = reading.scope ?? {};
    if (scope.kind === 'module' || scope.kind === 'file') {
      return {
        ...reading,
        scope: { ...scope, path: qualifyScopePath(packagePrefix, scope.path) },
      };
    }
    if (scope.kind === 'function') {
      return {
        ...reading,
        scope: { ...scope, file: qualifyScopePath(packagePrefix, scope.file) },
      };
    }
    return reading;
  });
}

export function optionalAdapterEnvelope(adapterName, root, skipTier = new Set(), options = {}) {
  const adapter = adapterDefinition(adapterName);
  if (!adapter) {
    throw new Error(`unknown adapter: ${adapterName}`);
  }
  const status = precheckAdapter(adapter, { root, skipTier, ...options });
  return {
    tool: adapter.name,
    sensor: adapter.sensor,
    protocol_version: PROTOCOL_VERSION,
    available: false,
    applicability: status.applicability,
    reason:
      status.applicability === 'applicable'
        ? 'adapter seam is available; port or install the lab adapter implementation to emit readings'
        : status.reason,
    readings: [],
  };
}

function parseCliArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--root=')) {
      args.root = arg.slice('--root='.length);
    } else if (arg === '--root' || arg === '--workspace-root') {
      args.root = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--workspace-root=')) {
      args.root = arg.slice('--workspace-root='.length);
    } else if (arg.startsWith('--skip-tier=')) {
      args.skipTier = [...(args.skipTier ?? []), arg.slice('--skip-tier='.length)];
    } else if (arg === '--skip-tier') {
      args.skipTier = [...(args.skipTier ?? []), argv[i + 1] ?? ''];
      i += 1;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

export function runCli(
  argv = process.argv.slice(2),
  io = { write: (s) => process.stdout.write(s) },
) {
  const [command, ...rest] = argv;
  const args = parseCliArgs(rest);
  const root = args.root ?? process.cwd();
  const skipTier = parseSkipTier(args.skipTier ?? []);
  if (command === 'manifest' || !command) {
    io.write(`${JSON.stringify(adapterManifest(root, skipTier), null, 2)}\n`);
    return 0;
  }
  if (command === 'run-sentrux') {
    io.write(`${JSON.stringify(optionalAdapterEnvelope('sentrux', root, skipTier), null, 2)}\n`);
    return 0;
  }
  if (command === 'run-grimp') {
    io.write(
      `${JSON.stringify(optionalAdapterEnvelope('grimp-instability', root, skipTier), null, 2)}\n`,
    );
    return 0;
  }
  throw new Error(`unknown adapters command: ${command}`);
}

function isScriptEntry() {
  return process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isScriptEntry()) {
  try {
    process.exit(runCli());
  } catch (err) {
    process.stderr.write(`adapters: ${err?.message ?? String(err)}\n`);
    process.exit(2);
  }
}
