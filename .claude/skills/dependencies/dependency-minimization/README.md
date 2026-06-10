# Dependency Minimization

Deep-dive companion to the `dependencies` SLP, principle 10 (minimize the dependency surface; prefer shallow trees).

The headline of this principle is uncomfortable for engineers who learned that "don't reinvent the wheel" is a virtue. The full claim is narrower than that and less controversial than it sounds: every dependency is a trust relationship the project takes on, transitively, with someone the project did not pick. Reducing the count of those relationships, and the depth of the chain through which they reach the project, is one of the few supply-chain interventions that compounds over time. Other defenses (audit gates, hash verification, SHA-pinning) catch problems; minimization avoids them.

This document explains the heuristics that make the principle operational, walks through one worked example (the `syntropic137-npx` setup CLI), and points at the tooling for keeping the tree visible.

## The cost of a dependency

A useful frame: every direct dependency carries four ongoing costs.

1. **Trust cost.** The maintainer can publish a new version that runs in your installs and your runtime tomorrow. You did not interview them; they did not interview you.
2. **Transitive cost.** The dependency carries its own dependencies, which carry theirs. Each of those is a separate trust relationship with a different maintainer. A direct dependency that pulls in 150 transitives is 151 trust relationships, not one.
3. **Maintenance cost.** Upstream may stop releasing. A dependency that is no longer maintained accumulates unpatched CVEs at exactly the rate the wider ecosystem accumulates them, and the project inherits the lag.
4. **Cognitive cost.** Each dependency is one more thing a contributor has to know exists, where it is configured, and what its idioms are.

The first three of those compound; the fourth is linear. The compounding ones are why a smaller surface beats a larger one even when each individual dependency is high-quality.

## Heuristics

Five heuristics make the principle operational at the day-to-day level. They are presented in the order you would apply them when evaluating a candidate dependency.

### 1. Default to writing it before installing it

The default move when faced with "I need a small utility" is to write the small utility, not to install a package. AI assistance has changed the calculus here decisively: a 50-line helper that the project owns and reviews is now cheap to produce, and the lifetime cost of a transitive trust relationship is unchanged. Installing the package is the answer when the problem is large, when the solution is genuinely shared in the ecosystem, or when the package solves a real correctness problem (timezone math, cryptographic primitives) that hand-rolled code is likely to get wrong.

The question is not "could I write this?" It is "is the cost of writing this larger than the lifetime cost of trusting an external maintainer with my installs forever?" Often the honest answer is no.

### 2. Prefer one-layer-deep over deep transitive trees

Among packages that solve the same problem, the transitive count is a first-class signal of risk. A package with zero runtime dependencies (Zod is a canonical example: a TypeScript schema validator with no runtime transitives) is materially safer than one that pulls in dozens, even if both are equally well-maintained at the top of the tree.

This generalizes: the count of trust relationships, not just the count of bytes, is the relevant cost. Two packages of similar value should be compared on the size of the tree they bring with them, not just on their direct surface.

### 3. Zero dependencies for lightweight entry points

Setup CLIs, install scripts, vendored bootstrappers, and any other surface that is the *first thing* every user runs deserve a stricter rule: zero runtime dependencies, full stop. Reasons:

- Entry-point surfaces are run with elevated trust. The user is asking the script to set up their environment; whatever the script depends on runs with whatever credentials the user has at hand. A poisoned transitive there has the largest possible blast radius.
- Entry-point surfaces are typically small. The engineering cost of writing the few utilities yourself is bounded; the lifetime supply-chain cost of a transitive tree is not.
- Entry-point surfaces are run by everyone, including users who never see the rest of the project's defenses. Hash verification in CI does not help a user running `npx setup` on a laptop.

The discipline is to maintain the rule as a hard constraint, not a preference. When the rule is preference, every "just one tiny dep" wins; when it is hard, the question "do we relax the zero-dep rule for the entire entry point package?" gets asked with the right scope.

### 4. Question heavy transitive trees explicitly

When evaluating a new dependency, look at the tree before adopting:

- `pnpm why <package>` shows why a package ended up in the project's tree.
- `npm ls <package>` and `npm ls --depth=1` show direct and immediate transitive structure.
- `uv tree --depth 3` shows the Python tree to a controlled depth.
- `cargo tree` for Rust; `go mod graph` for Go.

A package with three direct deps that pulls in 150 transitives is a red flag worth a sentence in the PR description. The signal is not that 150 transitives are necessarily bad; it is that the count is large enough to deserve a justification rather than passing silently.

### 5. Watch for abandonware adjacency

A direct dependency whose own transitive tree contains small, single-maintainer packages is making a maintenance bet on each of them, whether or not the team made it explicitly. The maintenance signal (principle 4 in the SLP) and the count signal (this principle) compound: a large tree of well-maintained packages is one risk profile; a large tree that contains two unmaintained transitives is a different one.

`npm-quick-run`, `npm-check`, OpenSSF Scorecard, and `deps.dev` all provide signals on the maintenance posture of the tree, not just the top of it.

## Worked example: syntropic137-npx

The `syntropic137-npx` package is the setup CLI for the Syntropic137 platform. It is the first surface every user touches when adopting the platform; users typically run it via `npx syntropic137-setup ...` against a fresh laptop or a fresh CI workspace.

The package enforces a strict zero-runtime-dependency rule: no `dependencies` block in `package.json`, only `devDependencies` for build and test tooling. The entire CLI ships as compiled output that depends on Node.js standard library only.

The justification follows directly from the heuristics above:

- **Trust cost is concentrated here.** The CLI is run by every user, often as the first command they execute against a new machine, with whatever credentials are at hand. A poisoned transitive on this surface has the largest possible blast radius.
- **The package is bounded in size.** The set of things a setup CLI does (filesystem, child process, HTTP fetch, prompt) is well covered by the standard library and small enough that hand-rolling utilities is bounded work.
- **The discipline holds because it is hard, not soft.** "Zero dependencies" admits no edge cases; the moment one dependency lands, the question becomes "where do we draw the line," which the project is poorly positioned to answer one PR at a time.

This is the canonical instance of the principle. Other entry-point surfaces (install scripts that run before any project setup, vendored bootstrappers, single-file tools intended to be downloaded and run) deserve the same rule.

## Enforce the rule as a fitness function

A minimization rule is an architectural characteristic of the project. Like every architectural characteristic, it stays true only if it is mechanically checked. A rule that lives in `CONTRIBUTING.md` ("we maintain zero runtime dependencies for this package") and nowhere else decays one PR at a time: a future contributor adds a `dependencies` entry, the reviewer does not catch the regression, and three months later the rule is folklore.

The fix is a fitness function: a small script that fails the build when the rule is violated. The framing comes from `Building Evolutionary Architectures` (Ford, Parsons, Kua, Sadalage) and is elaborated in the [`architecture` SLP's fitness-functions deep-dive](../../architecture/fitness-functions/README.md). This document covers the dependency-specific instances.

Three reference scripts ship next to this document under [scripts/](scripts/). Each is illustrative and standalone: copy and adapt to your project layout. They are written in Node (stdlib only, zero dependencies) so they are cross-platform by construction and so the fitness-function suite eats its own dogfood. A small Node test runner exercises the pure-function logic so the scripts are not just code copies; they are verified at the same time as everything else.

### Fitness function: zero runtime dependencies

[scripts/check-zero-deps.mjs](scripts/check-zero-deps.mjs) fails when `package.json` has a non-empty `dependencies` block. `devDependencies` are allowed (build and test tooling do not ship to users).

Wire it into CI as a required check. The PR that adds a dependency now produces an explicit, named-in-CI failure ("zero-deps fitness function"), which is the prompt for the human conversation about lifting the constraint. That conversation is exactly what the rule exists to force.

### Fitness function: maximum transitive depth

[scripts/check-tree-depth.mjs](scripts/check-tree-depth.mjs) fails when any direct dependency has more than `MAX_DEPTH` levels of transitives. The threshold is a project decision; useful values:

- `MAX_DEPTH=1`: strict one-layer-deep stance. Only direct dependencies that themselves have zero runtime dependencies are admitted. Materially shrinks the trust surface; works well for small libraries and well-bounded utilities.
- `MAX_DEPTH=3`: pragmatic mid-range. Allows most well-curated direct dependencies while catching the "this one package brings 150 transitives" red flag.
- no fitness function at all: the typical default in most ecosystems. Reasonable for application code that already has a large runtime; less so for libraries and entry points.

### Fitness function: transitive count budget

[scripts/check-transitive-count.mjs](scripts/check-transitive-count.mjs) caps the total number of resolved packages. Useful when depth is the wrong axis (a flat-but-wide tree is also a problem). The budget is a ratchet, not a freeze: it is set at a level the project is comfortable with and raised intentionally as scope grows. The point is to make every increase a deliberate decision rather than a silent accumulation.

### Tests

[scripts/test-fitness-functions.mjs](scripts/test-fitness-functions.mjs) exercises the zero-deps script against a fixture `package.json` in a temp directory. Run with `node --test scripts/test-fitness-functions.mjs`. The point is the shape, not the coverage: a fitness function that is itself testable is preferable to one that lives only inside a CI environment, because the project can verify the rule still works after every change to the script.

### Wiring the fitness functions into CI

Each script becomes a required check on PRs:

```yaml
# .github/workflows/dependencies.yml (sketch)
jobs:
  fitness:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<SHA> # vN
      - run: npm ci --ignore-scripts
      - run: node scripts/check-zero-deps.mjs
      - run: node scripts/check-tree-depth.mjs
        env:
          MAX_DEPTH: 1
      - run: node scripts/check-transitive-count.mjs
        env:
          MAX_PACKAGES: 50
      - run: node --test scripts/test-fitness-functions.mjs
```

A failing fitness function is a feature, not a bug: it is the project's stated minimization rule reaching out and saying "this PR violates a commitment we made." The right response is either to revise the PR or to raise the budget intentionally; both decisions belong on the record.

## What this principle is not

A few clarifications, because the principle is easy to caricature:

- **It is not a vow of poverty.** Frameworks, runtimes, ORMs, and other large, well-maintained, deeply-trusted dependencies earn their place. The principle is about the default stance, not about banning dependencies.
- **It is not "no transitives."** A package like Zod has zero runtime transitives by design; a package like a typical web framework has many by necessity. The discipline is to notice the difference and weigh it, not to treat zero as a hard rule everywhere.
- **It is not a substitute for the audit gate or hash verification.** Minimization shrinks the surface; the audit gate and hash verification harden whatever surface remains. They compose.
- **It is not anti-AI.** The opposite: the AI-assisted era is precisely what makes the heuristic of "default to writing it" newly affordable. The cost of producing the small helper has dropped; the cost of trusting an external maintainer has not.

## References back to the SLP

This deep-dive elaborates principle 10 of the [`dependencies` SLP](../SKILL.md). It composes with:

- **Principle 4 (maintenance signals).** The size of the tree multiplies the maintenance bet.
- **Principle 9 (cooldown).** Quarantine windows shrink the time during which a poisoned package can reach you; minimization shrinks the count of packages that could be poisoned.
- **Principle 11 (block install-time execution).** Each transitive that does not run is one fewer attack path; minimization reduces the count of would-be runners.
- **Principle 12 (verify content integrity).** Hashes verify what is installed; minimization reduces what is installed in the first place.

It also composes with the [`architecture` SLP's fitness-functions deep-dive](../../architecture/fitness-functions/README.md): when the project commits to a specific minimization rule, the rule belongs in CI as a fitness function rather than in a contributor doc, for the same reasons every other architectural characteristic does.

A reader entering this document should leave with two moves, not five: when adding the next dependency, ask whether the project actually needs it, and if it does, whether a lighter alternative is available that does not inflate the tree; and when the project agrees on a minimization rule, write the fitness function that enforces it before the next PR has a chance to violate it. Those two moves, applied consistently, capture most of the value of the principle.
