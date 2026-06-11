import { isMainEntry } from './lib/entrypoint';
import type { VendorFs, VendorReport } from './lib/vendor-links';
import {
  copySyncVendorMirrors,
  defaultVendorFs,
  verifyAndRepairVendorLinks,
} from './lib/vendor-links';

export interface AgentsLinkDeps {
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exit: (code: number) => never;
  cwd?: string;
  platform?: NodeJS.Platform;
  vendorFs?: VendorFs;
}

function logReport(prefix: string, report: VendorReport, deps: AgentsLinkDeps): void {
  const noun = report.mode === 'copy' ? 'vendor mirror' : 'vendor symlink';
  for (const name of report.ok) {
    deps.stdout.log(`${prefix}: ${noun} ${name} ok`);
  }
  for (const entry of report.repaired) {
    deps.stdout.log(`${prefix}: ${noun} ${entry}`);
  }
  for (const error of report.errors) {
    deps.stderr.error(`${prefix}: ${error}`);
  }
}

export function main(deps: AgentsLinkDeps): void {
  const cwd = deps.cwd ?? process.cwd();
  const platform = deps.platform ?? process.platform;
  const vendorFs = deps.vendorFs ?? defaultVendorFs();

  const report =
    platform === 'win32'
      ? copySyncVendorMirrors(cwd, vendorFs)
      : verifyAndRepairVendorLinks(cwd, vendorFs);
  logReport('agents link', report, deps);
  if (report.errors.length > 0) {
    deps.exit(1);
    return;
  }
  deps.stdout.log(
    report.mode === 'copy'
      ? 'agents link: complete using copy-sync fallback'
      : 'agents link: complete',
  );
}

/* v8 ignore next 8 */
if (isMainEntry(import.meta.url)) {
  main({
    stdout: console,
    stderr: console,
    exit: (code: number): never => process.exit(code),
  });
}
