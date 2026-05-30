import { z } from 'zod';

export const Platform = z.enum(['mac', 'linux', 'win', 'any']);
export type Platform = z.infer<typeof Platform>;

export const Check = z.object({
  id: z.string(),
  description: z.string(),
  command: z.array(z.string()).min(1),
  expect_stdout_contains: z.string().optional(),
  expect_stdout_match: z.string().optional(),
  expect_exit: z.number().int().default(0),
  remediation: z.string(),
  platform: Platform.default('any'),
});
export type Check = z.infer<typeof Check>;

export const Probe = z.object({
  name: z.string(),
  description: z.string(),
  checks: z.array(Check).min(1),
});
export type Probe = z.infer<typeof Probe>;

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  id: string;
  description: string;
  status: CheckStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  remediation?: string;
  skipReason?: string;
}

export interface ProbeResult {
  name: string;
  description: string;
  checks: CheckResult[];
  pass: number;
  fail: number;
  skip: number;
}

export interface DoctorReport {
  probes: ProbeResult[];
  overallExit: 0 | 1;
}
