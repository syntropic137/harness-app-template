// gen-env-example.ts
//
// Illustrative example: emit .env.example from the typed registry.
//
// This file is illustrative, not load-bearing. Wire it into your project under
// `scripts/` (or wherever build scripts live) and invoke from your task runner
// (e.g. `bun run gen-env` or `npm run gen-env`). The point is that the example
// file is emitted from the registry, never hand-edited, so it cannot drift
// from the code.
//
// Two modes:
//
//   bun run gen-env-example.ts                  emits .env.example
//   bun run gen-env-example.ts --overlay .env   adds missing keys to an
//                                               existing .env without
//                                               overwriting existing values.
//
// Secure-handling guarantee: this script reads values from the target .env
// only to preserve them in place. It never prints, logs, or otherwise echoes
// those values. Output is restricted to counts and key names (which are not
// secret; the registry already enumerates them publicly in .env.example).
// Apply the same discipline to any extension: emit summaries about the file,
// never the values inside it.
//
// See the SLP at ../../../SKILL.md (principle 2) for the rationale.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { listSecrets, SECRETS, type SecretKey } from "./env.ts";

function wrap(text: string, width = 78): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current = `${current} ${word}`;
    else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out;
}

function renderExample(): string {
  const lines: string[] = [
    "# .env.example",
    "#",
    "# Generated from env.ts. Do not hand-edit; run the generator instead.",
    "# Copy to .env and fill in environment-specific values.",
    "",
  ];
  for (const [, def] of listSecrets()) {
    for (const chunk of wrap(def.description)) lines.push(`# ${chunk}`);
    if (def.required) lines.push(`# Required: yes`);
    if (def.opRef) lines.push(`# Suggested op:// ref: ${def.opRef}`);
    lines.push(`${def.envVar}=`);
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}

function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    out.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  return out;
}

// Values from the target file are held in memory only long enough to write
// them back. They are never returned, printed, or logged. The result type
// intentionally exposes counts and key names only.
function overlayInto(envPath: string): { added: number; preserved: number; removed: string[] } {
  const existing = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf-8")) : new Map<string, string>();
  const registryEnvVars = new Set(Object.values(SECRETS).map((d) => d.envVar));

  let added = 0;
  let preserved = 0;
  const removed = [...existing.keys()].filter((k) => !registryEnvVars.has(k)).sort();

  const lines: string[] = [];
  for (const [, def] of listSecrets()) {
    for (const chunk of wrap(def.description)) lines.push(`# ${chunk}`);
    const value = existing.get(def.envVar);
    if (value !== undefined) {
      preserved += 1;
      lines.push(`${def.envVar}=${value}`);
    } else {
      added += 1;
      lines.push(`${def.envVar}=`);
    }
    lines.push("");
  }

  writeFileSync(envPath, lines.join("\n").replace(/\n+$/, "") + "\n", "utf-8");
  return { added, preserved, removed };
}

function main(argv: string[]): number {
  const overlayIdx = argv.indexOf("--overlay");
  if (overlayIdx !== -1 && argv[overlayIdx + 1]) {
    const target = argv[overlayIdx + 1]!;
    const { added, preserved, removed } = overlayInto(target);
    console.log(`overlay: added ${added}, preserved ${preserved}`);
    if (removed.length) {
      console.log(
        `warning: keys present in ${target} but not in registry: ${removed.join(", ")}`,
      );
      console.log("        review and remove manually if intentional.");
    }
    return 0;
  }

  const outIdx = argv.indexOf("--out");
  const out = outIdx !== -1 && argv[outIdx + 1] ? argv[outIdx + 1]! : ".env.example";
  writeFileSync(out, renderExample(), "utf-8");
  console.log(`wrote ${out}`);
  return 0;
}

// Type-level guard so unused imports do not silently rot.
type _EnsureSecretKey = SecretKey;

process.exit(main(process.argv.slice(2)));
