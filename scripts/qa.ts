import { isMainEntry } from './lib/entrypoint';
import { runInherit } from './lib/git';
import { main as lintMain } from './lint';
import { main as testMain } from './test';
import { main as typecheckMain } from './typecheck';

const SECRET_SCAN_SCRIPT = `
if ! command -v gitleaks >/dev/null 2>&1; then
  printf "%s\\n" "error: gitleaks is required for the qa secret-scan gate but is not on PATH." >&2
  printf "%s\\n" "  Install:  brew install gitleaks  (macOS)" >&2
  printf "%s\\n" "            apt install gitleaks   (Debian/Ubuntu)" >&2
  printf "%s\\n" "            https://github.com/gitleaks/gitleaks/releases  (single binary)" >&2
  printf "%s\\n" "  Rationale: docs/adrs/ADR-0009-secret-scanner.md" >&2
  exit 1
fi
gitleaks detect --redact --no-banner
`.trim();

export function main(argv: string[] = []): void {
  typecheckMain(argv);
  lintMain(argv);
  testMain(argv);
  // Profile (ADR-0028): `just qa` runs the LEAN `local` profile, matching the
  // lefthook pre-push `sensors-gate` hook. A bare checkout / fresh fork /
  // scaffolded project has none of the instrumented adapters installed
  // (apss-topology data, ubs, sentrux, coverage), so the fail-closed `strict`
  // profile would (correctly) reject it for "no reading". The canonical strict
  // enforcer is the dedicated `fitness` CI job (`sensors gate --profile=strict`,
  // where every adapter IS provisioned); qa stays lean so the dev inner loop
  // and the fork/scaffolder E2Es gate on the always-available pure-node
  // adapters (deadcode, cruiser-coupling, complexity) without requiring the
  // heavy toolchain.
  runInherit('harness/sensors/bin/sensors', ['gate', '--profile=local']);
  runInherit('sh', ['-eu', '-c', SECRET_SCAN_SCRIPT]);
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2));
}
