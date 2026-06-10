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
  runInherit('harness/sensors/bin/sensors', ['gate']);
  runInherit('sh', ['-eu', '-c', SECRET_SCAN_SCRIPT]);
}

/* v8 ignore next 3 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
