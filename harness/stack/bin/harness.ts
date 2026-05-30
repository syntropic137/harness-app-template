#!/usr/bin/env tsx
import { boot } from '../src/commands/boot.js';
import { destroy } from '../src/commands/destroy.js';
import { doctor } from '../src/commands/doctor.js';
import { inspect, ports } from '../src/commands/inspect.js';
import { stop } from '../src/commands/stop.js';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const [cmd, ...rest] = argv;

const commands: Record<string, (args: string[]) => Promise<number>> = {
  boot,
  inspect,
  ports,
  stop,
  destroy,
  doctor,
};

const fn = cmd ? commands[cmd] : undefined;
if (!fn) {
  console.error(`Usage: harness <boot|inspect|ports|stop|destroy|doctor> [...args]`);
  process.exit(1);
}
process.exit(await fn(rest));
