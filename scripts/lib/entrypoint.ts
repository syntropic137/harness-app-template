import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Returns true when the module identified by `importMetaUrl` is the
 * process entrypoint (the script the runtime invoked at the top of the
 * call stack), even when the runtime path contains spaces or symlinks.
 *
 * The naive comparison `import.meta.url === \`file://${process.argv[1]}\``
 * silently fails in two real adopter scenarios the template has hit:
 *
 *  1. Path with spaces — Bun and Node URL-encode the space as %20 in
 *     `import.meta.url` but leave `process.argv[1]` raw, so the string
 *     equality never holds and `main()` silently no-ops on every
 *     scripts/*.ts entrypoint.
 *  2. Symlinked checkout (e.g. `/data/projects/<org>--<repo>` on the
 *     swarm VPS) — the runtime canonicalizes `import.meta.url` through
 *     realpath while leaving `process.argv[1]` as the symlinked path.
 *
 * Canonicalize both sides through `realpathSync(fileURLToPath(...))`
 * so the comparison holds under either skew. The lookup is guarded by
 * try/catch because the entrypoint path may not exist on disk in
 * synthetic test sandboxes.
 */
export function isMainEntry(importMetaUrl: string): boolean {
  const argv = process.argv[1];
  if (!argv) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(argv);
  } catch {
    return false;
  }
}
