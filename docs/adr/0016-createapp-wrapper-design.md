# Design Note: `create-harness-app` npx wrapper

**Date:** 2026-05-30
**Status:** Draft / Research
**Bead:** `create-harness-app-z1d`

## Objective
Build `create-harness-app` as a separate, `npx`-deployable Node.js CLI tool that scaffolds projects using the `syntropic137/harness-app-template` repository. It must support multi-template selection and variable substitution.

## Core Flow
1. **Interactive Prompts:** Ask the user for the project name, destination directory, and which template variant to use (e.g., `polyglot-monorepo`).
2. **Fetch Template:** Rather than bundling the template inside the npm package, pull the latest release or main branch tarball directly from `syntropic137/harness-app-template` via GitHub API (or using a tool like `tiged`). This decouples CLI releases from template updates.
3. **Variable Substitution:** Walk through the downloaded files (like `README.md`, `CLAUDE.md`, `package.json`, etc.) and replace placeholder variables like `{{PROJECT_NAME}}` with the user's input.
4. **Initialization:** Run `git init` in the new directory.
5. **Handoff:** Print out the next steps (e.g., `cd <dir>`, `just bootstrap`).

## Technical Stack
- **Runtime:** Node.js (fastest startup for `npx` flows).
- **CLI Framework:** `commander` or plain parsing.
- **Interactivity:** `prompts` (lightweight, user-friendly).
- **Styling:** `kolorist` or `picocolors` (smaller than `chalk`).
- **File Ops / Fetching:** Native `fetch` + `tar` (or `tiged` if preferred) for downloading the archive, `fs` for variable substitution.

## Repository Structure
```text
create-harness-app/
├── package.json         # bin: { "create-harness-app": "./bin/cli.js" }
├── bin/
│   └── cli.js           # Executable entrypoint
├── src/
│   ├── index.ts         # Main orchestrator
│   ├── prompts.ts       # Interactive questions
│   ├── fetch.ts         # Tarball download & extraction
│   └── transform.ts     # Regex variable replacement
└── README.md
```

## Open Questions / Future Work
- Should the wrapper invoke `just bootstrap` automatically, or leave that to the user? (Usually better to leave to the user to avoid opaque installation errors).
- Managing API rate limits if relying entirely on GitHub's unauthenticated tarball endpoints.