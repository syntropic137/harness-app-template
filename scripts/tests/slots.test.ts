import { describe, expect, test } from 'vitest';
import { resolveSlotInvocation, type SlotConfig } from '../lib/slots';

const activeSensorsSlot: SlotConfig = {
  contract: 'sensors',
  plugin: 'harness-sensors',
  version: '0.6.2-ts-adapter+abstractness',
  required: false,
  swappable: true,
  interface: {
    type: 'cli',
    entrypoint: 'harness/sensors/bin/sensors',
    commands: ['report', 'gate'],
  },
  decisionAt: 'docs/adrs/ADR-0006-sensors.md',
};

function manifest(slot: SlotConfig): string {
  return `${JSON.stringify({ slots: { sensors: slot } })}\n`;
}

describe('slot manifest resolver', () => {
  test('uses the manifest entrypoint for an active slot', () => {
    const invocation = resolveSlotInvocation('sensors', ['--help'], {
      cwd: '/repo',
      readText: () => manifest(activeSensorsSlot),
    });

    expect(invocation).toMatchObject({
      disabled: false,
      command: 'harness/sensors/bin/sensors',
      args: ['--help'],
    });
  });

  test('skips an optional slot when plugin is none', () => {
    const invocation = resolveSlotInvocation('sensors', ['report'], {
      cwd: '/repo',
      readText: () =>
        manifest({
          ...activeSensorsSlot,
          plugin: 'none',
        }),
    });

    expect(invocation).toMatchObject({
      disabled: true,
      args: ['report'],
      message: 'Slot sensors skipped because harness.manifest.json sets plugin to none.',
    });
  });

  test('rejects a required slot when plugin is none', () => {
    expect(() =>
      resolveSlotInvocation('sensors', ['report'], {
        cwd: '/repo',
        readText: () =>
          manifest({
            ...activeSensorsSlot,
            plugin: 'none',
            required: true,
          }),
      }),
    ).toThrow('Required slot sensors is disabled in harness.manifest.json');
  });

  test('rejects a slot entry that names a different contract', () => {
    expect(() =>
      resolveSlotInvocation('sensors', ['report'], {
        cwd: '/repo',
        readText: () =>
          manifest({
            ...activeSensorsSlot,
            contract: 'inspector',
          }),
      }),
    ).toThrow('Slot sensors has contract inspector in harness.manifest.json');
  });

  test('reports malformed manifest JSON with the manifest path', () => {
    expect(() =>
      resolveSlotInvocation('sensors', ['report'], {
        cwd: '/repo',
        readText: () => '{',
      }),
    ).toThrow('/repo/harness.manifest.json is not valid JSON:');
  });
});
