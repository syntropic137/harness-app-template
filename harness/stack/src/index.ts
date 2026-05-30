// harness/stack public API.
// Implements ADR-0001-stack-manager.
//
// Post-split (experiment 2026-05-15--stack-runtime-topology-split): the source
// tree is structured into three communities — runtime/, topology/, commands/.
// External callers get a stable surface via re-exports from this top-level
// barrel; the internal layout is free to evolve under it.

// Re-export the runtime and topology communities so external consumers
// cross a single community boundary instead of reaching into individual leaves.
export * as runtime from './runtime/index.js';
export type { HarnessConfig } from './topology/config.js';
export { defineHarnessConfig } from './topology/config.js';
export * as topology from './topology/index.js';
