#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SLOT_NAME = 'doc-validator';
const SLOT_FILE = 'harness.manifest.json';
const FALLBACK_ENTRYPOINT = 'harness/doc-validator/bin/doc-validator';

function resolveSlotEntrypoint() {
  const manifest = JSON.parse(readFileSync(SLOT_FILE, 'utf8'));
  const slot = manifest?.slots?.[SLOT_NAME];
  if (!slot) {
    return {
      command: FALLBACK_ENTRYPOINT,
      args: process.argv.slice(2),
      disabled: false,
      slotName: SLOT_NAME,
    };
  }
  if (slot.contract !== SLOT_NAME) {
    throw new Error(`Slot ${SLOT_NAME} has contract ${slot.contract} in harness.manifest.json`);
  }
  if (slot.plugin === 'none') {
    if (slot.required) {
      throw new Error(`Required slot ${SLOT_NAME} is disabled in harness.manifest.json`);
    }
    return { command: '', args: process.argv.slice(2), disabled: true, slotName: SLOT_NAME };
  }
  const command = slot.interface?.entrypoint ?? FALLBACK_ENTRYPOINT;
  return { command, args: process.argv.slice(2), disabled: false, slotName: SLOT_NAME };
}

function run(command, args) {
  if (typeof command !== 'string' || command.length === 0) {
    return 0;
  }
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 0;
}

function runApssValidate() {
  const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/apss.mjs')], {
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 0;
}

function main() {
  const argv = process.argv.slice(2);
  const runApss = argv.includes('--apss');
  const filtered = argv.filter((arg) => arg !== '--apss');
  if (runApss) {
    return process.exit(runApssValidate());
  }

  const invocation = resolveSlotEntrypoint();
  if (invocation.disabled) {
    console.log(
      `Slot ${invocation.slotName} skipped because harness.manifest.json sets plugin to none.`,
    );
    return;
  }
  process.exit(run(invocation.command, filtered));
}

try {
  main();
} catch (error) {
  process.stderr.write(`doc-validator wrapper: ${error?.message ?? String(error)}\n`);
  process.exit(1);
}
