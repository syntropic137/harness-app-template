// dependency-cruiser config for the polyglot-monorepo template.
//
// Scope: the workspace's first-party TypeScript/JavaScript under ws_apps/ and
// ws_packages/. node_modules is excluded so the metric distribution reflects
// our own code, not vendor internals.
//
// Used by:
//   - `npx dependency-cruiser --metrics --output-type json` (manual run)
//   - `harness/sensors/bin/sensors report` (the sensors-slot aggregator)
//
// Why these knobs (see experiments/2026-05-30--depcruiser-arch-quality/):
//   - includeOnly: bare directory args + `--no-config` returned totalCruised=0;
//     pinning the scope here makes `npx dependency-cruiser .` work directly.
//   - excludePattern: without it the cruise follows vitest into node_modules
//     and the metric set becomes 92% vendor noise.
//   - tsPreCompilationDeps: required so type-only imports show up as edges
//     (otherwise interface/type files look like orphans).

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [],
  options: {
    includeOnly: '^(ws_apps|ws_packages)/',
    exclude: {
      // Drop vendor code, dist/build artifacts, and Next.js-style out/ trees
      // — none of these are first-party workspace source.
      path: '(^|/)(node_modules|dist|build|out|\\.next|coverage)(/|$)',
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      // We use --metrics + --output-type json from the CLI; reporters here are
      // only relevant if a consumer fork wires up `npx depcruise --output-type text`.
      text: { highlightFocused: true },
    },
  },
};
