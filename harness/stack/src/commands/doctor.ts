import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { detectIsolation, tryCapture } from '../runtime/index.js';
import { type CheckResult, type DoctorReport, Probe, type ProbeResult } from '../topology/index.js';

interface DoctorOpts {
  probeFilter?: string;
  json: boolean;
  explainId?: string;
}

function parseArgs(args: string[]): DoctorOpts {
  const opts: DoctorOpts = { json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') {
      opts.json = true;
    } else if (a === '--explain') {
      const next = args[++i];
      if (next) opts.explainId = next;
    } else if (a && !a.startsWith('--')) {
      opts.probeFilter = a;
    }
  }
  return opts;
}

function currentPlatform(): 'mac' | 'linux' | 'win' {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'win32') return 'win';
  return 'linux';
}

export function loadProbes(probesDir: string): Probe[] {
  if (!existsSync(probesDir)) {
    return [];
  }
  const files = readdirSync(probesDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .filter((f) => !f.startsWith('_'))
    .sort();
  return files.map((f) => {
    const raw = readFileSync(join(probesDir, f), 'utf8');
    const data = parseYaml(raw);
    return Probe.parse(data);
  });
}

function checkMatches(out: string, contains?: string, match?: string): boolean {
  if (contains && !out.includes(contains)) return false;
  if (match && !new RegExp(match).test(out)) return false;
  return true;
}

export async function runCheck(check: Probe['checks'][number]): Promise<CheckResult> {
  const platform = currentPlatform();
  if (check.platform !== 'any' && check.platform !== platform) {
    return {
      id: check.id,
      description: check.description,
      status: 'skip',
      exitCode: null,
      stdout: '',
      stderr: '',
      skipReason: `platform ${platform} != ${check.platform}`,
    };
  }
  const [bin, ...rest] = check.command;
  if (!bin) {
    return {
      id: check.id,
      description: check.description,
      status: 'fail',
      exitCode: null,
      stdout: '',
      stderr: 'empty command',
      remediation: check.remediation,
    };
  }
  const { exitCode, stdout, stderr } = await tryCapture(bin, rest);
  const exitOk = exitCode === check.expect_exit;
  const stdoutOk = checkMatches(stdout, check.expect_stdout_contains, check.expect_stdout_match);
  const passed = exitOk && stdoutOk;
  return {
    id: check.id,
    description: check.description,
    status: passed ? 'pass' : 'fail',
    exitCode,
    stdout,
    stderr,
    ...(passed ? {} : { remediation: check.remediation }),
  };
}

async function runProbe(probe: Probe): Promise<ProbeResult> {
  const results = await Promise.all(probe.checks.map(runCheck));
  return {
    name: probe.name,
    description: probe.description,
    checks: results,
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skip: results.filter((r) => r.status === 'skip').length,
  };
}

function formatHuman(report: DoctorReport): string {
  const lines: string[] = [];
  for (const probe of report.probes) {
    const header =
      probe.fail === 0
        ? `✅ ${probe.name} — ${probe.description}`
        : `❌ ${probe.name} — ${probe.description} (${probe.fail} fail)`;
    lines.push(header);
    for (const check of probe.checks) {
      const icon = check.status === 'pass' ? '  ✓' : check.status === 'skip' ? '  ⊘' : '  ✗';
      lines.push(`${icon} ${check.id} — ${check.description}`);
      if (check.status === 'fail' && check.remediation) {
        for (const ln of check.remediation.split('\n')) lines.push(`      ${ln}`);
      }
      if (check.status === 'skip' && check.skipReason) {
        lines.push(`      ${check.skipReason}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function explain(probes: Probe[], id: string): string {
  for (const probe of probes) {
    for (const check of probe.checks) {
      if (check.id === id) {
        return [
          `Probe: ${probe.name}`,
          `Check: ${check.id} — ${check.description}`,
          `Command: ${check.command.join(' ')}`,
          '',
          'Remediation:',
          check.remediation,
        ].join('\n');
      }
    }
  }
  return `Unknown check id: ${id}`;
}

export async function doctor(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  const iso = detectIsolation();
  const probesDir = join(iso.worktreePath, 'infra', 'doctor');
  const all = loadProbes(probesDir);
  if (all.length === 0 && !opts.probeFilter && !opts.explainId) {
    const report: DoctorReport = { probes: [], overallExit: 0 };
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('No doctor probes configured.');
    }
    return 0;
  }

  if (opts.explainId) {
    console.log(explain(all, opts.explainId));
    return 0;
  }

  const selected = opts.probeFilter ? all.filter((p) => p.name === opts.probeFilter) : all;
  if (selected.length === 0) {
    console.error(`No probes matched. Available: ${all.map((p) => p.name).join(', ') || '(none)'}`);
    return 1;
  }

  const results = await Promise.all(selected.map(runProbe));
  const overallExit: 0 | 1 = results.some((r) => r.fail > 0) ? 1 : 0;
  const report: DoctorReport = { probes: results, overallExit };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
  }
  return overallExit;
}
