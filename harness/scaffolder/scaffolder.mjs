// create-harness-app: turn the canonical template into a clean, fork-ready
// project. Design lives in docs/superpowers/specs/create-harness-app-
// scaffolder-design.md. This file is the MVP implementation of that spec:
//
//   - copy the canonical template tree into <dest>, excluding build/cache
//     directories and the strip-list paths (template-only artifacts),
//   - run `bun run scripts/init.ts <name> --no-verify` from <dest> to reuse
//     the substitution engine (renames, provenance, root pyproject, compose
//     name, README block strip),
//   - fresh `git init` + one commit (unless --no-git),
//   - print a next-steps banner pointing at `just bootstrap` / `just qa` /
//     `just fitness`.
//
// The implementation is dependency-injected so the unit tests cover every
// branch without touching the real filesystem, real git, or real init.ts.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,213}$/;

// Build/cache directories the scaffolder never copies out of the template.
// Mirrors scripts/lib/fs.ts SKIP_DIRS plus .git: a generated project gets
// a fresh `git init`, not a copy of the template's history.
export const COPY_SKIP_DIRS = new Set([
  '.git',
  '.turbo',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);

// Basename suffixes the scaffolder skips at copy time. Editors and MCP-config
// tools sometimes drop `<file>.<pid>.<ts>.<seq>.0.bak` snapshots alongside
// their source; the basenames are unpredictable so strip-list.json (which is
// exact-path only) cannot enumerate them. Filter them here as
// defense-in-depth so a developer's local working tree never leaks `.bak`
// auto-backups into a generated project.
export const COPY_SKIP_BASENAME_SUFFIXES = ['.bak'];

export function validateProjectName(name) {
  if (typeof name !== 'string' || !PROJECT_RE.test(name)) {
    throw new Error(
      'project name must match npm-safe pattern ^[a-z0-9][a-z0-9-]*$ and be <= 214 chars',
    );
  }
}

export function readStripList(stripListPath, deps = defaultDeps()) {
  const raw = deps.readFile(stripListPath);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.paths)) {
    throw new Error(`strip-list ${stripListPath}: missing "paths" array`);
  }
  for (const path of parsed.paths) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error(`strip-list ${stripListPath}: paths entries must be non-empty strings`);
    }
    if (isAbsolute(path) || path.includes('..')) {
      throw new Error(
        `strip-list ${stripListPath}: paths must be relative and within the template root (got ${path})`,
      );
    }
  }
  return parsed.paths;
}

// Recursively copy <src> into <dest>, skipping COPY_SKIP_DIRS and any
// strip-list path so the destination is born without template-only state.
// Symlinks are preserved verbatim (the template's vendor mirrors like
// CLAUDE.md / .codex are symlinks at AGENTS.md and must continue pointing
// at the new project's AGENTS.md). Files or directories whose basename is
// in COPY_SKIP_DIRS are skipped regardless of type — git worktrees store
// .git as a file, not a directory, so a type-only filter would copy it.
export function copyTemplate(src, dest, skipRel, deps = defaultDeps()) {
  const skipSet = new Set(skipRel);
  const visit = (rel) => {
    const fromAbs = rel === '' ? src : join(src, rel);
    const toAbs = rel === '' ? dest : join(dest, rel);
    if (rel !== '') {
      const name = rel.split('/').at(-1);
      if (
        COPY_SKIP_DIRS.has(name) ||
        skipSet.has(rel) ||
        COPY_SKIP_BASENAME_SUFFIXES.some((suffix) => name.endsWith(suffix))
      ) {
        return;
      }
    }
    const st = deps.lstatSync(fromAbs);
    if (st.isSymbolicLink()) {
      deps.mkdirSync(dirname(toAbs), { recursive: true });
      deps.symlinkSync(deps.readlinkSync(fromAbs), toAbs);
      return;
    }
    if (st.isDirectory()) {
      deps.mkdirSync(toAbs, { recursive: true });
      for (const entry of deps.readdirSync(fromAbs)) {
        visit(rel === '' ? entry : `${rel}/${entry}`);
      }
      return;
    }
    deps.mkdirSync(dirname(toAbs), { recursive: true });
    deps.cpSync(fromAbs, toAbs, { preserveTimestamps: true });
  };
  visit('');
}

// Apply the strip list AFTER copy. Mirrors the listed paths under <dest>
// and removes them if present. Missing entries are no-ops by design (see
// strip-list.json description for the canonical-CI invariant).
export function applyStripList(dest, stripPaths, deps = defaultDeps()) {
  const removed = [];
  for (const rel of stripPaths) {
    const abs = join(dest, rel);
    if (deps.existsSync(abs)) {
      deps.rmSync(abs, { recursive: true, force: true });
      removed.push(rel);
    }
  }
  return removed;
}

export function runInit(dest, projectName, deps = defaultDeps()) {
  const result = deps.spawnSync('bun', ['run', 'scripts/init.ts', projectName, '--no-verify'], {
    cwd: dest,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`scripts/init.ts exited ${result.status}`);
  }
}

export function gitInitCommit(dest, deps = defaultDeps()) {
  const gitArgs = ['-c', 'core.hooksPath=/dev/null'];
  const env = {
    ...deps.env(),
    GIT_AUTHOR_NAME: deps.env().GIT_AUTHOR_NAME ?? 'create-harness-app',
    GIT_AUTHOR_EMAIL: deps.env().GIT_AUTHOR_EMAIL ?? 'create-harness-app@local',
    GIT_COMMITTER_NAME: deps.env().GIT_COMMITTER_NAME ?? 'create-harness-app',
    GIT_COMMITTER_EMAIL: deps.env().GIT_COMMITTER_EMAIL ?? 'create-harness-app@local',
  };
  const steps = [
    ['init', '-q', '-b', 'main'],
    ['add', '-A'],
    ['commit', '-q', '-m', 'chore: scaffold from create-harness-app'],
  ];
  for (const args of steps) {
    const result = deps.spawnSync('git', [...gitArgs, ...args], {
      cwd: dest,
      stdio: 'inherit',
      env,
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`git ${args[0]} exited ${result.status}`);
    }
  }
}

export const HELP_TEXT = `create-harness-app <name> [options]

Arguments:
  <name>              project name; must match ^[a-z0-9][a-z0-9-]{0,213}$

Options:
  --yes, -y           skip prompts; use defaults (current MVP default).
  --dry-run           print the planned operations to stdout. No writes.
  --no-git            do not run git init in the destination.
  --template-root <p> override the template source root (testing/internal).
  --dest <path>       destination directory. Default: ./<name>.
  --strip-list <path> override the strip-list.json location.
  --version, -V       print the CLI version.
  --help, -h          show this help text.

Default behaviour: every slot + every example app, fresh git init with one
commit, prints next-steps for just bootstrap / just qa / just fitness.
`;

function readPackageVersion(deps = defaultDeps()) {
  const pkgPath = join(deps.entryDir(), 'package.json');
  try {
    return JSON.parse(deps.readFile(pkgPath)).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function parseArgs(argv) {
  const opts = {
    name: null,
    yes: false,
    dryRun: false,
    noGit: false,
    help: false,
    version: false,
    templateRoot: null,
    dest: null,
    stripList: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-V') {
      opts.version = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      opts.yes = true;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--no-git') {
      opts.noGit = true;
      continue;
    }
    if (arg === '--template-root') {
      opts.templateRoot = argv[++i] ?? null;
      continue;
    }
    if (arg === '--dest') {
      opts.dest = argv[++i] ?? null;
      continue;
    }
    if (arg === '--strip-list') {
      opts.stripList = argv[++i] ?? null;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    }
    if (opts.name === null) {
      opts.name = arg;
      continue;
    }
    throw new Error(`unexpected positional argument: ${arg}`);
  }
  return opts;
}

// Resolve the canonical template root. The scaffolder lives at
// harness/scaffolder/, so the template root is two parents up from the
// directory holding scaffolder.mjs. Callers can override with
// --template-root for tests or for future bundled-snapshot mode.
export function defaultTemplateRoot(deps = defaultDeps()) {
  return resolve(deps.entryDir(), '..', '..');
}

export function defaultStripList(deps = defaultDeps()) {
  return join(deps.entryDir(), 'strip-list.json');
}

export function nextStepsBanner(name, dest) {
  return [
    `created ${name} at ${dest}`,
    '',
    'next:',
    `  cd ${dest}`,
    '  just bootstrap     # one-time tool install + lefthook',
    '  just qa            # workspace lint + typecheck + test',
    '  just fitness       # READ-ONLY architectural-fitness report',
  ].join('\n');
}

export function planSummary({ name, templateRoot, dest, stripList, noGit }) {
  return [
    `would scaffold ${name}`,
    `  template: ${templateRoot}`,
    `  dest:     ${dest}`,
    `  strip:    ${stripList.length} paths from ${stripList[0] ?? '(empty)'} ...`,
    `  git:      ${noGit ? 'skip' : 'init + commit'}`,
  ].join('\n');
}

function ensureDestUsable(dest, deps) {
  if (!deps.existsSync(dest)) {
    return;
  }
  const entries = deps.readdirSync(dest);
  if (entries.length > 0) {
    throw new Error(`destination ${dest} exists and is not empty`);
  }
}

export function scaffold(opts, deps = defaultDeps()) {
  validateProjectName(opts.name);
  const templateRoot = opts.templateRoot ?? defaultTemplateRoot(deps);
  const stripListPath = opts.stripList ?? defaultStripList(deps);
  const dest = resolve(opts.dest ?? join(deps.cwd(), opts.name));
  const stripPaths = readStripList(stripListPath, deps);

  if (opts.dryRun) {
    deps.log(
      planSummary({
        name: opts.name,
        templateRoot,
        dest,
        stripList: stripPaths,
        noGit: opts.noGit,
      }),
    );
    return { dest, stripPaths, ranInit: false, ranGit: false };
  }

  ensureDestUsable(dest, deps);
  deps.mkdirSync(dest, { recursive: true });
  copyTemplate(templateRoot, dest, stripPaths, deps);
  const removed = applyStripList(dest, stripPaths, deps);
  runInit(dest, opts.name, deps);
  let ranGit = false;
  if (!opts.noGit) {
    gitInitCommit(dest, deps);
    ranGit = true;
  }
  deps.log(nextStepsBanner(opts.name, dest));
  return { dest, stripPaths, removed, ranInit: true, ranGit };
}

export function main(argv, deps = defaultDeps()) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    deps.errorLog(`error: ${error.message}`);
    deps.errorLog(HELP_TEXT);
    deps.exit(64);
    return;
  }
  if (opts.help) {
    deps.log(HELP_TEXT);
    deps.exit(0);
    return;
  }
  if (opts.version) {
    deps.log(readPackageVersion(deps));
    deps.exit(0);
    return;
  }
  if (opts.name === null) {
    deps.errorLog('error: missing required <name> positional argument');
    deps.errorLog(HELP_TEXT);
    deps.exit(64);
    return;
  }
  try {
    scaffold(opts, deps);
    deps.exit(0);
  } catch (error) {
    deps.errorLog(`error: ${error instanceof Error ? error.message : String(error)}`);
    deps.exit(1);
  }
}

// Default dependencies bind the live filesystem / process surfaces. Tests
// pass a custom `deps` object to redirect every side effect.
export function defaultDeps() {
  return {
    readFile: (path) => readFileSync(path, 'utf8'),
    existsSync: (path) => existsSync(path),
    lstatSync: (path) => lstatSync(path),
    readdirSync: (path) => readdirSync(path),
    mkdirSync: (path, opts) => mkdirSync(path, opts),
    cpSync: (from, to, opts) => cpSync(from, to, opts),
    rmSync: (path, opts) => rmSync(path, opts),
    symlinkSync: (target, dest) => symlinkSync(target, dest),
    readlinkSync: (path) => readlinkSync(path),
    spawnSync: (cmd, args, opts) => spawnSync(cmd, args, opts),
    cwd: () => process.cwd(),
    env: () => process.env,
    entryDir: () => dirname(fileURLToPath(import.meta.url)),
    log: (msg) => process.stdout.write(`${msg}\n`),
    errorLog: (msg) => process.stderr.write(`${msg}\n`),
    exit: (code) => process.exit(code),
  };
}
