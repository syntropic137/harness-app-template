#!/usr/bin/env node
// CLI entry for `create-harness-app`. Thin shim: parses argv, dispatches
// to ../scaffolder.mjs#main. See harness/scaffolder/scaffolder.mjs for
// the implementation and docs/superpowers/specs/create-harness-app-
// scaffolder-design.md for the design contract.

import { main } from '../scaffolder.mjs';

main(process.argv.slice(2));
