// complexity.mjs — ts-morph adapter emitting per-function cyclomatic and
// cognitive complexity rolled up per source.  Pairs with abstractness.mjs
// to feed the same aggregator (bead create-harness-app-n48.5).
//
// **Cyclomatic complexity** — the classic McCabe metric: 1 + the count of
// linearly-independent branching nodes in the function (if, for, while,
// do-while, case, catch, ?:, and short-circuit operators &&/||/??).
//
// **Cognitive complexity** — *Sonar-shaped approximation* of G. Ann
// Campbell's 2018 algorithm.  Each "control-flow break" node adds
// `1 + nesting_depth`, and entering one of those nodes increases the
// nesting depth for descendants.  V1 simplifications (documented so a
// future swap to `eslint-plugin-sonarjs` / `cognitive-complexity-ts` is
// clean):
//   1. Each occurrence of `&&` / `||` / `??` counts +1 (Sonar collapses
//      same-operator chains to one increment; we overcount, conservatively).
//   2. `else if` is treated as a nested `if` (Sonar's B3 rule says no
//      nesting penalty for else / else-if; we apply the penalty —
//      conservative).
//   3. Recursion is not detected (Sonar adds +1 for direct recursion).
//   4. Labelled break/continue is not detected (rare in TS).
//
// Net effect: this metric is monotonic with — and >= — the canonical
// Sonar value for typical TS code.  Good enough for a sensor floor; an
// exact-Sonar adapter can land later under the same shape.
//
// Output (per source):
//   { source, function_count,
//     max_cyclomatic, median_cyclomatic,
//     max_cognitive, median_cognitive,
//     high_cognitive_count, high_cyclomatic_count,
//     functions: [{name, line, cyclomatic, cognitive}, ...] }
//
// `high_cognitive_count` and `high_cyclomatic_count` are the "spread"
// signal that complements the peak metrics: count of functions in this
// source whose cognitive (resp. cyclomatic) complexity is at or above the
// HIGH_*_THRESHOLD constants below. The thresholds are the industry
// "review-needed" line (Sonar / McCabe guidance starts flagging at 5);
// the workspace-level sum becomes the MT01 `high-cognitive-fn-count`
// fitness metric so the upward ratchet catches "many medium-complex
// functions appearing while the peak gets refactored away" — the
// death-by-a-thousand-cuts pattern that pure peak metrics miss.
//
// Preservation-first: this file is additive next to abstractness.mjs and
// aggregate.mjs; no existing slot files are modified by its addition.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Project, SyntaxKind } from 'ts-morph';

const WORKSPACE_RE = /^(ws_apps|ws_packages)\//;

// "Review-needed" complexity thresholds used by the spread metric. Sonar's
// default cognitive-complexity rule starts flagging functions at 15
// (hard fail) and treats 5+ as the moderate band worth watching; McCabe
// cyclomatic guidance is similar (5 = simple-but-watch, 10 = review).
// 5 is the conservative pre-fail line: it catches a function that has
// taken on a meaningful branching/nesting load before the gate's peak
// metric (`max-cognitive` floor) is anywhere near tripped.
export const HIGH_COGNITIVE_THRESHOLD = 5;
export const HIGH_CYCLOMATIC_THRESHOLD = 5;

/** True when a cruiser `modules[].source` string is workspace code. */
export function isWorkspaceSource(name) {
  return typeof name === 'string' && WORKSPACE_RE.test(name) && !name.startsWith('node_modules');
}

const BRANCH_KINDS = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.CaseClause,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
]);

const SHORT_CIRCUIT_TOKENS = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);

/** McCabe cyclomatic complexity for one function-shaped AST root. */
export function cyclomaticOf(rootNode) {
  let count = 1;
  rootNode.forEachDescendant((node) => {
    const k = node.getKind();
    if (BRANCH_KINDS.has(k)) {
      count += 1;
      return;
    }
    if (k === SyntaxKind.BinaryExpression) {
      const op = node.getOperatorToken().getKind();
      if (SHORT_CIRCUIT_TOKENS.has(op)) {
        count += 1;
      }
    }
  });
  return count;
}

const NESTING_KINDS = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
]);

const COGNITIVE_INCREMENT_KINDS = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
]);

/** Sonar-shaped cognitive complexity (approximation — see file header). */
export function cognitiveOf(rootNode) {
  let total = 0;
  const walk = (node, depth) => {
    const k = node.getKind();
    let inc = 0;
    let pushedDepth = 0;
    if (COGNITIVE_INCREMENT_KINDS.has(k)) {
      inc = 1 + depth;
    } else if (k === SyntaxKind.BinaryExpression) {
      const op = node.getOperatorToken().getKind();
      if (SHORT_CIRCUIT_TOKENS.has(op)) {
        inc = 1;
      }
    }
    if (NESTING_KINDS.has(k) && node !== rootNode) {
      pushedDepth = 1;
    }
    total += inc;
    for (const child of node.getChildren()) {
      walk(child, depth + pushedDepth);
    }
  };
  walk(rootNode, 0);
  return total;
}

const FUNCTION_LIKE_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionExpression,
]);

/** Pick a readable function name from any function-like declaration. */
function functionLabel(node) {
  const k = node.getKind();
  if (k === SyntaxKind.Constructor) {
    return 'constructor';
  }
  // ts-morph's NamedNode interface — try the canonical getName(), fall back.
  if (typeof node.getName === 'function') {
    const n = node.getName();
    if (typeof n === 'string' && n.length > 0) {
      return n;
    }
  }
  return '<anonymous>';
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Compute per-function metrics for every function-like node in a SourceFile. */
export function classifyModule(sourceFile) {
  const functions = [];
  sourceFile.forEachDescendant((node) => {
    if (!FUNCTION_LIKE_KINDS.has(node.getKind())) {
      return;
    }
    functions.push({
      name: functionLabel(node),
      line: typeof node.getStartLineNumber === 'function' ? node.getStartLineNumber() : null,
      cyclomatic: cyclomaticOf(node),
      cognitive: cognitiveOf(node),
    });
  });
  const cyclomaticValues = functions.map((f) => f.cyclomatic);
  const cognitiveValues = functions.map((f) => f.cognitive);
  return {
    function_count: functions.length,
    max_cyclomatic: functions.length === 0 ? null : Math.max(...cyclomaticValues),
    median_cyclomatic: median(cyclomaticValues),
    max_cognitive: functions.length === 0 ? null : Math.max(...cognitiveValues),
    median_cognitive: median(cognitiveValues),
    high_cognitive_count: cognitiveValues.filter((v) => v >= HIGH_COGNITIVE_THRESHOLD).length,
    high_cyclomatic_count: cyclomaticValues.filter((v) => v >= HIGH_CYCLOMATIC_THRESHOLD).length,
    functions,
  };
}

/**
 * Analyze a list of workspace file paths.  Project is optional so tests
 * can pass an in-memory ts-morph project.
 */
export function analyzeFiles(filePaths, { project } = {}) {
  const p =
    project ??
    new Project({
      useInMemoryFileSystem: false,
      compilerOptions: { allowJs: true, noEmit: true },
    });
  const readings = [];
  for (const path of filePaths) {
    if (typeof path !== 'string' || path.length === 0) {
      continue;
    }
    let sf;
    try {
      sf = project
        ? (p.getSourceFile(path) ?? p.addSourceFileAtPath(path))
        : p.addSourceFileAtPath(path);
    } catch (err) {
      readings.push({
        source: path,
        function_count: 0,
        max_cyclomatic: null,
        median_cyclomatic: null,
        max_cognitive: null,
        median_cognitive: null,
        high_cognitive_count: 0,
        high_cyclomatic_count: 0,
        functions: [],
        error: err.message,
      });
      continue;
    }
    const m = classifyModule(sf);
    readings.push({ source: path, ...m });
  }
  return readings;
}

/** Extract workspace .ts/.tsx source paths from a cruiser JSON object. */
export function workspaceSourcesFromCruiser(cruiser) {
  const out = new Set();
  for (const m of cruiser?.modules ?? []) {
    const s = m?.source;
    if (isWorkspaceSource(s) && /\.(ts|tsx)$/.test(s)) {
      out.add(s);
    }
  }
  return [...out].sort();
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** CLI entry: cruiser JSON in → ts-morph-complexity readings JSON out. */
export async function main(
  argv = process.argv.slice(2),
  io = { read: readStdin, write: (s) => process.stdout.write(s) },
) {
  let raw;
  try {
    raw = await io.read();
  } catch (err) {
    process.stderr.write(`complexity: failed to read stdin (${err.message})\n`);
    return 2;
  }
  if (raw.trim().length === 0) {
    process.stderr.write('complexity: empty stdin — pipe cruiser JSON in\n');
    return 2;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`complexity: stdin is not valid JSON (${err.message})\n`);
    return 2;
  }
  const sources = workspaceSourcesFromCruiser(parsed);
  const readings = analyzeFiles(sources);
  io.write(`${JSON.stringify({ tool: 'ts-morph-complexity', readings }, null, 2)}\n`);
  void argv;
  return 0;
}

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
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`complexity: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}
