import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type ReadText = (path: string) => string;

export type SlotInterfaceType = 'cli' | 'config' | 'compose' | 'library' | 'directory' | 'external';

export interface SlotInterface {
  type: SlotInterfaceType;
  entrypoint?: string;
  commands?: string[];
  config?: string[];
}

export interface SlotConfig {
  contract: string;
  plugin: string;
  version?: string;
  required: boolean;
  swappable: boolean;
  interface: SlotInterface;
  implementation?: string;
  decisionAt?: string;
}

export interface HarnessManifest {
  name?: string;
  version?: string;
  slots: Record<string, SlotConfig>;
}

interface ActiveSlotInvocation {
  disabled: false;
  command: string;
  args: string[];
  slot: SlotConfig;
}

interface DisabledSlotInvocation {
  disabled: true;
  args: string[];
  message: string;
  slot: SlotConfig;
}

export type SlotInvocation = ActiveSlotInvocation | DisabledSlotInvocation;

interface ResolveSlotOptions {
  cwd?: string;
  fallbackEntrypoint?: string;
  readText?: ReadText;
}

export function loadHarnessManifest(
  cwd = process.cwd(),
  readText: ReadText = (path) => readFileSync(path, 'utf8'),
): HarnessManifest {
  const manifestPath = join(cwd, 'harness.manifest.json');
  try {
    return JSON.parse(readText(manifestPath)) as HarnessManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${manifestPath} is not valid JSON: ${message}`);
  }
}

export function resolveSlotInvocation(
  slotName: string,
  args: string[],
  options: ResolveSlotOptions = {},
): SlotInvocation {
  const manifest = loadHarnessManifest(options.cwd, options.readText);
  const slot = manifest.slots?.[slotName];

  if (!slot) {
    if (options.fallbackEntrypoint) {
      return {
        disabled: false,
        command: options.fallbackEntrypoint,
        args,
        slot: fallbackSlot(slotName, options.fallbackEntrypoint),
      };
    }
    throw new Error(`Slot ${slotName} is not defined in harness.manifest.json`);
  }

  if (slot.contract !== slotName) {
    throw new Error(`Slot ${slotName} has contract ${slot.contract} in harness.manifest.json`);
  }

  if (slot.plugin === 'none') {
    if (slot.required) {
      throw new Error(`Required slot ${slotName} is disabled in harness.manifest.json`);
    }

    return {
      disabled: true,
      args,
      message: `Slot ${slotName} skipped because harness.manifest.json sets plugin to none.`,
      slot,
    };
  }

  const command = slot.interface?.entrypoint ?? options.fallbackEntrypoint;
  if (!command) {
    throw new Error(
      `Slot ${slotName} does not define interface.entrypoint in harness.manifest.json`,
    );
  }

  return {
    disabled: false,
    command,
    args,
    slot,
  };
}

function fallbackSlot(slotName: string, entrypoint: string): SlotConfig {
  return {
    contract: slotName,
    plugin: 'fallback',
    required: true,
    swappable: false,
    interface: {
      type: 'cli',
      entrypoint,
    },
  };
}
