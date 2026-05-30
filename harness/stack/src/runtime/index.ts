// runtime/ — process + repo-isolation primitives.
//
// Exports the shell-execution + git-isolation building blocks every command
// uses. One module barrel collapses the import surface so command files
// reference a single community boundary (`../runtime`) instead of two
// individual leaf files. Investigation 2026-05-15-harness-modularity.

export * from './exec.js';
export * from './isolation.js';
