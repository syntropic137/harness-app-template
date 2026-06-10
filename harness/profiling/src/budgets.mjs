// harness/profiling/src/budgets.mjs - per-signal perf budgets
// (bead create-harness-app-z41).
//
// Reads the documented TOML subset used by harness/profiling/budgets.toml:
//   - comments (#) and blank lines
//   - table headers: [signals."api.latency.p99"] (dotted path, segments
//     optionally double-quoted so signal names can contain dots)
//   - key = value lines where value is a number, true/false, or a
//     double-quoted string
//
// The subset is deliberate: budgets are flat per-signal tables, so a full
// TOML implementation buys nothing but a dependency. Anything outside the
// subset is a hard parse error (fail closed, never silently ignore a
// budget line).

const DEFAULT_TOLERANCE = 0.25;

class BudgetParseError extends Error {
  constructor(line, lineNumber, reason) {
    super(`budgets parse error at line ${lineNumber}: ${reason} (${line.trim()})`);
    this.name = 'BudgetParseError';
  }
}

function parseHeaderPath(header, line, lineNumber) {
  if (header.length === 0) {
    throw new BudgetParseError(line, lineNumber, 'empty table header');
  }
  const path = [];
  let rest = header;
  while (rest.length > 0) {
    let segment;
    if (rest.startsWith('"')) {
      const close = rest.indexOf('"', 1);
      if (close === -1) {
        throw new BudgetParseError(line, lineNumber, 'unterminated quoted table segment');
      }
      segment = rest.slice(1, close);
      rest = rest.slice(close + 1);
    } else {
      const dot = rest.indexOf('.');
      segment = dot === -1 ? rest : rest.slice(0, dot);
      rest = dot === -1 ? '' : rest.slice(dot);
    }
    if (segment.length === 0) {
      throw new BudgetParseError(line, lineNumber, 'empty table segment');
    }
    path.push(segment.trim());
    if (rest.startsWith('.')) {
      rest = rest.slice(1);
      if (rest.length === 0) {
        throw new BudgetParseError(line, lineNumber, 'trailing dot in table header');
      }
    } else if (rest.length > 0) {
      throw new BudgetParseError(line, lineNumber, 'malformed table header');
    }
  }
  return path;
}

function parseValue(raw, line, lineNumber) {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  const num = Number(raw);
  if (raw.length > 0 && Number.isFinite(num)) {
    return num;
  }
  throw new BudgetParseError(line, lineNumber, `unsupported value ${raw}`);
}

/** Parse the TOML subset into a nested plain object. */
export function parseTomlSubset(text) {
  const root = {};
  let current = root;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const stripped = line.replace(/#.*$/, '').trim();
    if (stripped.length === 0) {
      continue;
    }
    if (stripped.startsWith('[') && stripped.endsWith(']')) {
      const path = parseHeaderPath(stripped.slice(1, -1).trim(), line, i + 1);
      current = root;
      for (const segment of path) {
        if (typeof current[segment] !== 'object' || current[segment] === null) {
          current[segment] = {};
        }
        current = current[segment];
      }
      continue;
    }
    const eq = stripped.indexOf('=');
    if (eq === -1) {
      throw new BudgetParseError(line, i + 1, 'expected key = value or [table]');
    }
    const key = stripped.slice(0, eq).trim().replace(/^"|"$/g, '');
    if (key.length === 0) {
      throw new BudgetParseError(line, i + 1, 'empty key');
    }
    current[key] = parseValue(stripped.slice(eq + 1).trim(), line, i + 1);
  }
  return root;
}

/**
 * Normalize a parsed budgets document into {signals: {name: budget}} where
 * budget is {budget?, tolerance, gate, direction}. Unknown keys are kept
 * (forward compatibility) but the four known ones are validated.
 */
export function normalizeBudgets(doc) {
  const signals = {};
  const raw = doc?.signals ?? {};
  for (const [name, entry] of Object.entries(raw)) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`budget for signal ${name} must be a table`);
    }
    const out = { ...entry };
    if (out.budget !== undefined && typeof out.budget !== 'number') {
      throw new Error(`budget for signal ${name} must be a number`);
    }
    if (out.tolerance === undefined) {
      out.tolerance = DEFAULT_TOLERANCE;
    } else if (typeof out.tolerance !== 'number' || out.tolerance < 0) {
      throw new Error(`tolerance for signal ${name} must be a non-negative number`);
    }
    if (out.gate === undefined) {
      out.gate = false;
    } else if (typeof out.gate !== 'boolean') {
      throw new Error(`gate for signal ${name} must be true or false`);
    }
    if (out.direction === undefined) {
      out.direction = 'lower';
    } else if (out.direction !== 'lower' && out.direction !== 'higher') {
      throw new Error(`direction for signal ${name} must be "lower" or "higher"`);
    }
    signals[name] = out;
  }
  return { signals };
}

/** Parse budgets.toml text end to end. */
export function loadBudgets(text) {
  return normalizeBudgets(parseTomlSubset(text));
}

export { DEFAULT_TOLERANCE };
