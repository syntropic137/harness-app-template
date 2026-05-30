// topology/ — config + compose + port allocation.
//
// Exports the deterministic-isolation topology primitives: how ports get
// allocated, how compose files get generated, how env vars get derived
// from project config. One module barrel collapses the import surface so
// command files reference a single community boundary (`../topology`).
// Investigation 2026-05-15-harness-modularity.

export * from './compose.js';
export * from './config.js';
export * from './doctor-schema.js';
export * from './env.js';
export * from './ports.js';
