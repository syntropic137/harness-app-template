---
name: "Land v2: merge queue and input-keyed gate cache"
description: "Split landing into verify and land. A merge queue verifies each branch speculatively against main plus the branches queued ahead of it, and records gate evidence keyed by each gate's inputs (a persistent form of inheritUnaffectedEvidence, never looser than it). Land then only checks that evidence exists for the exact tree and base and fast-forwards main with a compare-and-swap push, target under 5 s. Preview moves after land; guards stay on the push; no numeric threshold is lowered."
status: proposed
---

# ADR-0034: Land v2, merge queue and input-keyed gate cache

**Date:** 2026-10-09
**Category:** Slot (task-runner / hooks)
**Supersedes:** none (builds on [ADR-0033](./ADR-0033-gated-landing-flow.md), which stays the verification engine)
**Next review:** 2027-04-09

## The contract: what land guarantees

This section comes first because it is the first thing the operator asked for:
"we need to define what land is supposed to accomplish and stop foot gunning
ourselves" (typos corrected; the verbatim text is in the DreamShip KMS capture
`areas/planning/2026-10-09-operator-verbatim-land-merge-queue-under-5s.md`).
Everything else in this ADR is a way to keep these promises faster. A check that
serves none of them does not belong in land.

When `just land` reports **landed** for a ref, all of the following hold:

1. **C1. Main moved by exactly one verified step.** `origin/<target>` was
   updated from the exact tip `M` that land checked to a commit `C` that
   descends from `M`, by a compare-and-swap push that fails if the tip is no
   longer `M`. No merge, rebase or cherry-pick happens inside land; those happen
   during verification, which produced `C`.
2. **C2. Every required gate passed for that commit and its verification
   base.** `C` was verified as one speculative chain built on a base `B` (the
   main tip when the chain was built), and every commit in `B..M` is a queue
   commit of that same chain. For every gate and check in the required set
   declared **on `B`** that applies to `B..C`, an evidence record exists whose
   input key matches `C` and `B` (decision 3). The record came from a real run
   of that gate, on `C` or on inputs with the same key.
3. **C3. No numeric pass criterion was weakened.** The cache and the queue
   decide *whether a gate must run again*, never *what passing means*. No
   threshold, floor or ratchet held in a declared policy file differs from what
   `B` declares, and a candidate cannot relax the policy that judges it
   (decision 4 states the limit of this). Two acceptance changes are deliberate
   and stated, not hidden: the preview stops blocking (decision 5), and a
   quarantined test stops blocking within the bounds of decision 9.
4. **C4. The push guards ran on the actual push.** `guard-main-push`,
   `push-scope-guard` and `versioning-release-check` ran inside the pre-push
   hook, each failing closed on its own (a missing tool refuses the push),
   against the real ref update, from a checkout of `C`. They are a
   default-closer, not a boundary (decision 6).
5. **C5. Success is observed, not inferred.** As in ADR-0033: after the push,
   `git merge-base --is-ancestor C origin/<target>`, whatever the push's exit
   status said. If `C` was already on main before this run pushed anything,
   land reports **already landed** (exit 0, no push, distinct message), never
   **landed**.
6. **C6. Every run leaves a receipt.** One `runs.jsonl` line per stage run, with
   per-step seconds, cache hits and outcome. A receipt that cannot be written is
   reported loudly; as in ADR-0033 it never changes an outcome that has already
   happened on the remote.

What land does **not** promise: that the change boots in a preview (a post-land
check, decision 5), that the required gate set is complete (known gaps are
listed in Details), or that a bypass is impossible (C4).

Time budget for the land stage alone, in the operator's words: "land should take
<5 seconds ... <5 min is like the bare minimum, 20 minutes is critical". Under
5 s is the target, 5 min the bare minimum, 20 min critical.

## Context

ADR-0033 moved gates out of `git push`, ran them once in a persistent worktree
and made success observable. It fixed the failure class it was written for. It
did not change the shape: **a land is still the full verification**, run
serially on one machine under one lease, and every agent waits for it.

### Measured history (DreamShip dogfood, the operator's Mac)

From the `runs.jsonl` receipts ADR-0033 added (#96), 2026-10-08 14:00Z to
2026-10-09, 60 non-dry lands:

| Measure | Value |
|---|---|
| Lands that succeeded / failed | 34 / 26 |
| Total wall clock, p50 / p90 | 669 s / 1716 s |
| Work time (total minus lease and load wait), p50 / p90 | 653 s / 1337 s |
| Longest lease plus load wait | 2725 s |
| Preview step (`landing-evidence`) when it ran, p50 | 641 s |
| `test-retry` steps (a retry after a flaky first run) | 19 |

Lands of 17-20 minutes were routine. The individual causes, each found and
fixed or filed one at a time:

- **The suite ran twice in one land.** The `test` gate and lefthook's `cov-ts`
  both ran `vitest run scripts/tests`, concurrently, in one worktree. DreamShip
  `fc0dfaea`/`6fef0d85` skip the duplicate when `cov-ts` runs it
  (`scripts/lib/land-cov-ts-overlap.ts`); the land that shipped it (tip
  `948a447e`) took **302 s**, against **1186 s** for the land before it
  (`ac788b03`). A 4x gain from removing one duplicate says how much of the time
  was waste, and also where the floor is: the real suites, about 5 minutes.
- **Two suites raced on `coverage/.tmp`** (DreamShip bead
  `land-stages-race-on-coverage-tmp-hm5uj`). Dropping `--coverage` from one run
  stopped the file race but not the starvation.
- **Fixed-path collisions.** Tests that spawn HTTP listeners, stand-in binaries
  and fixture repos failed in 40 ms under a concurrent run and passed in 555 ms
  alone (DreamShip paper cuts B138, B139); concurrent lands sharing a cargo
  target dir compiled one land's crate against another's rlibs (`68lfu`).
- **The preview leaked.** Preview worktrees and servers started by lands were
  never torn down: 79 worktrees, about 100 GB, 392 serve directories, servers up
  13 days, disk at 96% (`kfzzj`).
- **The lease was used as a lock.** The lease serializes the whole 10-20 minute
  run. It has no queue, so a `--wait` caller polled for 32 minutes and lost the
  lease twice to lands that arrived later (paper cut B136).
- **Flakes under load decide outcomes.** A 100% coverage floor turned one timed
  out test into a failed land on a diff that measured 100% itself (B137); some
  tests fail only under high load (`d7htg`).

Each fix was local and correct. The shape kept producing the next one, because
verification and landing are the same act: every agent pays the full suite on
its own critical path, serialized, on a machine that is also its workstation.

The question this ADR closes: **how does land get from minutes to seconds
without lowering any gate?**

## Decision

Split the act in two. **Verification** produces evidence and may take as long as
the gates take, off the agent's critical path. **Land** consumes evidence and
does nothing else.

### 1. Land is a guarded fast-forward over recorded evidence

`land(ref)` runs in its own push checkout, separate from any verification
worktree:

1. Fetch. Let `M` be `origin/<target>`.
2. First consult the queue's original-to-landed mapping: if the ref's pinned SHA
   already landed (under any base), report **already landed** and stop. Else find
   the verified commit `C` for it and its verification base `B` (decision 2).
   Refuse with a distinct exit code ("not verified on current main") unless
   `M` is an ancestor of `C`, `B` is an ancestor of `M`, and every commit in
   `B..M` belongs to the same queue chain as `C`. Land never runs gates.
3. Read the required set from `B`'s `land.config.json`. For every required gate
   and check that applies to `B..C`, look up the evidence record for its input
   key (decision 3). A missing record refuses and names the gate.
4. Check out `C` in the push checkout and push it with
   `--force-with-lease=refs/heads/<target>:<M>`, so the update is a
   compare-and-swap on the exact `M` that step 3 checked (a plain push would
   still succeed if main had moved to some other ancestor of `C`). The push
   carries the SHA-bound marker; `LEFTHOOK_EXCLUDE` follows today's
   `excludedJobs` rule (jobs with evidence on `C` plus jobs inapplicable to
   `M..C`), and the guards are never in it (decision 6).
5. Fetch and check `merge-base --is-ancestor C origin/<target>` (C5). Append the
   receipt (C6).

The lease is held for steps 1-5, all of which take seconds, so the
already-landed lookup, the evidence check and the push see one consistent
state, and a land that finds its `C` pushed meanwhile by another land reports
**already landed**, not **landed**. It guards the push checkout. Verification worktrees are owned by the worker (decision 7),
not by the lease, and `--local` (below) keeps today's lease-for-the-whole-run
behaviour because it uses the shared landing worktree.

### 2. A merge queue verifies speculatively

Semantics follow bors-ng (Graydon Hoare's "not rocket science rule": main always
passes its tests, because only what was tested gets merged), GitHub merge queue
and Zuul's dependent pipeline:

- **Enqueue pins a SHA.** `just land <ref>` enqueues the commit the ref names at
  that moment. Moving the ref afterwards does not change the queued entry; a new
  push to the branch is a new entry.
- **Each entry's patch is its own commits.** For entry `b_k`, the patch is the
  commits in `M..b_k` that are not already in the speculative tree ahead of it,
  matched by commit id through the queue's original-to-applied mapping, never
  by patch id (which would drop a deliberate re-application after an earlier
  revert). A branch stacked on an earlier entry
  contributes only its own commits. The queue keeps the mapping from each
  original commit to the commit it became.
- **Speculative trees.** Entry `k` is verified on `S_k = S_(k-1) + patch(b_k)`,
  with `S_0 = B`, the main tip when the chain was built, using the ADR-0033
  apply modes. Every `S_k` is verified on base `B` as a whole, so its evidence
  covers everything from `B` to `S_k`. `S_k` is a real commit
  and its SHA is what lands (a cherry-pick mints new SHAs, as ADR-0033 already
  handles).
- **Bound to the speculative base.** The worker verifies `S_k` against an
  immutable base SHA it is given, not against whatever the remote tip is when
  it runs. Every gate, check and diff-scoped hook gets that base (today's
  `harness.hookBaseRemote`/`hookBaseRef` injection becomes a SHA).
- **Ejection.** When entry `j` fails, it is removed and reported. Every entry
  behind it is rebuilt without `b_j`. An entry whose own ancestry contains an
  ejected entry's commits is ejected too, and says why. The rest are
  re-verified, with evidence reused only where input keys are unchanged.
- **Main moves outside the queue** (a direct `metadataSafe` push such as a beads
  sync): every entry is rebuilt on the new tip and re-verified the same way.
- **Landing in order.** When the head entry has full evidence, land runs for it.
  Main then sits at `S_1`, which is part of the chain, so `S_2`'s evidence on
  base `B` still satisfies C2 and it needs no re-verification. The chain is
  rebuilt only when main moves to something that is not its own commit (an
  outside push or an ejection). Main may also fast-forward straight to `S_k`
  (bors batching), but only on `S_k`'s own complete evidence set; green
  intermediate entries are not a substitute.
- **Order is FIFO by enqueue time**, stored by the queue, not decided by who
  polls first.

`just land <ref>` becomes "enqueue and wait for the result"; `--no-wait`
enqueues and returns. Today's one-shot behaviour (verify, then land, in one
process on this machine, under the lease) stays available as
`just land <ref> --local` until the queue is proven. It is also the fallback
when no worker is reachable.

### 3. Gate evidence is cached by inputs, never more loosely than today

This is the existing `inheritUnaffectedEvidence`, made persistent. Today the
engine keeps an in-memory `Evidence` (`sha`, `passed`) per land and, when `main`
moves mid-land, carries a gate's pass to the new SHA if the delta between the
two SHAs misses the gate's `when` scopes (`inheritEvidence` in
`scripts/lib/land/engine.ts`). That result is forgotten when the process exits.
v2 keeps the rule and stores the result on disk, keyed so a later run, another
queue entry, or land can look it up. There is no second cache.

**Terms defined here.** New in this ADR. Everything else is ADR-0033 and engine
vocabulary (gate, check, scope, `when`, lane, lease, evidence, run receipt).

- **Gate inputs.** What a gate's outcome depends on. `land.config.json` gains:
  - `inputs`: extra globs. They can only **add** to what the gate's `when`
    scopes already cover, never remove. Narrowing a key below today's scope
    rule is out of scope for this ADR.
  - `versions`: commands whose output identifies the tools (for example
    `rustc -V`, `node -v`). Lockfiles are ordinary inputs.
  - `wholeRepo: true` for gates that compare against `main` itself (the sensors
    ratchet, `vsa`, fitness baselines, cycle checks). They key on the whole
    tree and can never be `baseIndependent`.
  - `baseIndependent: true` for a gate whose result provably depends only on
    the tree, not on the base or the commit history. Opt-in only, and checked
    by the audit run.
  - `cache: false` for gates whose answer depends on time, network or state
    outside the tree (for example a CVE audit).
- **Input key.** `K(g, C, B)` is a hash of:
  - the gate's canonical config entry, read from `B`;
  - the git tree entries (path, mode, object id) of `lefthook.yml`,
    `land.config.json` and the land engine (`ALWAYS_FULL_GLOBS`);
  - the **execution environment**: the worker's OS and architecture, the
    output of the gate's `versions` commands, and a hash of the exact
    environment variables the engine passes to the gate (after ADR-0033's
    stripping), minus names in a declared `envIgnore` list. A worker that
    controls its environment gets stable keys; an ambient one gets misses,
    which is the safe direction;
  - the git tree entries (path, mode, object id) in `C` of every path matching
    its `when` scope globs and `inputs`, plus every path no scope claims and
    every path in `full`. For a `wholeRepo` gate, or one with no `when`, this is
    the whole tree of `C`. Mode is included, so an executable-bit change changes
    the key;
  - unless the gate is `baseIndependent`: **`B` and the commit ids of `B..C`**.
    This is the default for every gate and check, because many read the base or
    the history without saying so (lefthook jobs are diff-scoped through the
    injected hook base; `secret-scan` reads every commit in `{base}..{head}`).

  So by default, any movement of main and any change to the commit history
  invalidates a record, and only `baseIndependent` gates reuse evidence across
  them. In every case the key changes at least whenever `inheritEvidence` would
  discard the pass.
- **Not cacheable.** A gate is treated as `cache: false` when it declares no
  `versions`, runs with `cwd: source`, or rewrites tracked files listed in
  `ignoreDirty`. Its evidence is valid only for the verification run of exactly
  `(C, B)` that produced it, and only for `maxEvidenceAgeSeconds` (config,
  default one hour) at land time. `preflight` checks and checks of current
  operational state run during verification and are never cached. A condition
  that must still hold at the moment of the push belongs in a pre-push guard,
  not in evidence.
- **Evidence record.** One persisted pass: gate, input key, the tree and base it
  ran on, engine version, worker identity, start time, seconds, whether it
  passed only on a retry, and a pointer to its log. Only passes satisfy a
  lookup; failures are recorded for measurement. (The word "receipt" stays
  reserved for the `runs.jsonl` run receipt.)
- **Evidence store.** Where records live, behind a port (decision 7). The
  template ships a local file store under `~/.cache/harness-land/<repo-id>/`,
  next to `runs.jsonl`.

Applicability is unchanged: whether a gate is required for `B..C` is still
`gateApplies(when, classify(diff))`. The cache only decides whether an
applicable gate must run again.

**An under-declared input is a correctness bug.** If a gate depends on something
its key omits, a stale pass can satisfy C2. Defences:

1. **Fail toward running.** Keys are never narrower than today's scope rule,
   unclaimed and `full` paths are in every key, base and history dependence is
   the default, the effective environment is in the key, and anything not
   reproducible is not cacheable.
2. **Known non-hermetic inputs stay visible.** Gates still run in the landing
   worktree with its ignored build caches (`node_modules`, `target/`), and with
   the ambient environment minus the variables ADR-0033 strips. Those caches are
   assumed outcome-neutral; the audit run is what tests that assumption.
3. **The audit run.** On a schedule (default: nightly, and after every N lands),
   the worker re-runs **every** required gate, and the quarantine gate, on the
   current main tip with the cache disabled, in a fresh worktree with no ignored
   caches, and compares each result with the cached record for the same input
   key. A cached pass that the uncached run fails, and that fails again on a
   re-run (to separate it from a flake), is an under-declared input. That gate
   becomes `cache: false` and its existing records are invalidated until its
   declaration is fixed, and a tracking issue is filed. Results go to
   `runs.jsonl` under `stage: "audit"`.
4. **Sampled re-execution.** A configurable share of cache hits during
   verification also run for real and are compared the same way, so drift shows
   up between audits.

### 4. Required gates are data, and the candidate does not judge itself

The required set is everything `land.config.json` makes blocking today:
`preflight`, `earlyChecks`, `gates` and `checks`, plus a `required` flag
(default `true`) so a gate can run for information without blocking. Checks
that run with `cwd: source` are not cacheable (decision 3).

Land enforces the set **declared on the base `B`**, not the candidate's. (Today
the engine reads `land.config.json` from the invoking checkout, so a branch's own
config judges it; v2 closes that.) A candidate that changes the config is
verified under both `B`'s set and its own, and must pass both. A candidate that
removes a required gate or sets `required: false` therefore cannot land on its
own evidence.

The limit, stated plainly: gates execute the candidate's own hooks and scripts,
so a threshold written in code the candidate edits is only as protected as the
review of that code. v2 adds `policyFiles` (globs, for example
`harness/sensors/baseline.json` or a coverage config): a candidate that changes
one is refused by land unless the consumer's own relaxation path approves it,
which is how DreamShip already treats `baseline.json`. Thresholds outside
declared policy files are not protected by land, before or after this ADR. Known gaps in the set are tracked by the
consumer, not papered over by the engine (see Details).

### 5. Preview is a post-land check

A preview (boot the built app and judge it, `landing-evidence` in DreamShip)
runs on the new main tip after land, not before. This is a deliberate change
in what blocks, ratified with the rest of this design, not a side effect. A red
result is recorded against the landed tree, pages the operator and files an
issue. It does not auto-revert and does not block the queue; a consumer that
wants a stop-the-line rule makes that a separate decision. The post-land runner
owns teardown of whatever it starts.

### 6. The guards stay on the push, failing closed

`guard-main-push`, `push-scope-guard` and `versioning-release-check` run on the
actual push in decision 1, step 4, from the push checkout at `C`. The push
checkout therefore needs the repository's scripts and the guards' tools, and
their cost counts against land's 5 s budget, which slice 2 measures.

- The engine already refuses to list the first two as gates (`PROTECTED_JOBS`).
  v2 adds `versioning-release-check`, so its evidence never excludes it from the
  push. Consumers that list it as a gate today (DreamShip does) migrate their
  config in the same change as the parser.
- All three run unconditionally. lefthook skips every `commands:` job when it
  computes an empty push-file set (for example a push whose tree equals the
  remote's), so the guards run as lefthook `scripts:` entries, which that skip
  does not apply to, as `push-scope-guard` already does.
- `versioning-release-check` soft-skips today when Cargo, Bun or Just are
  missing. It must fail closed inside the hook instead, so a missing tool
  refuses the push before the ref update, not after. `guard-main-push` already
  fails closed when it reads no ref lines, and `push-scope-guard` (a lefthook
  script, exempt from lefthook's empty-push skip) refuses when the push set
  cannot be known. Land also records lefthook's summary in the receipt, as a
  measurement, not as the enforcement.

Without server-side branch protection these are a **default-closer, not a
boundary**: `--no-verify`, `LEFTHOOK=0`, a forged marker or a forged evidence
record all still get code onto main. What the design buys is that the gated path
is also the fast path, so bypassing it no longer saves time.

### 7. Where verification runs: the worker is a port

The engine defines a **worker** port: given an immutable base SHA, a speculative
commit and a list of gates, run them and return evidence records. A worker owns
its verification worktrees; nothing else writes to them. The template ships
one adapter, the local worker, which is today's engine on the same machine. A
remote adapter (for example SSH to a dedicated host) belongs to the consumer.
The evidence store is a second port, because land must read what a remote worker
wrote. Land itself needs git, read access to the evidence store, and the guard
toolchain in its push checkout.

The template takes no position on which host is the verifier.

### 8. Unchanged

- No numeric threshold, coverage floor, ratchet, `max_warnings` or `requires`
  changes value.
- Consumer rules about floors keep applying, and caching cannot route around
  them. In DreamShip: `harness/sensors/baseline.json` changes never travel
  through land (its `baseline-drift` check stays required, keyed on the file
  like any input), and the god-file/size trio accepts no agent-authored
  relaxation. The template engine enforces neither rule itself; they are
  consumer configuration, and a consumer adopting v2 keeps its own.
- A cached pass is only ever a pass on identical inputs. Caching cannot turn a
  failing ratchet green.

### 9. Flaky tests are quarantined, not tolerated

Quarantine is the second deliberate acceptance change (C3), so it is bounded:

- **Mechanism.** A versioned quarantine list (data, beside the gate config)
  names each test, its issue id, owner, date added and an expiry date. A
  quarantined test is excluded from required gates and runs in a non-required
  `quarantine` gate whose results are recorded. Adding an entry is a config
  change, so it is verified under `B`'s policy like any other (decision 4).
- **No threshold side door.** If excluding a test would take a coverage or
  ratchet floor below its value, the quarantine is refused, and the test is
  fixed instead (usually its timeout, or a fixed path or port).
- **Retries are visible.** `retryOnOutput` stays, but a pass that needed a retry
  is flagged in its evidence record. Repeated retry-passes for one gate are what
  nominate a test for quarantine.
- **Exit path.** The audit run executes the quarantine gate. A quarantined test
  leaves the list after N consecutive audit passes (default 20). At expiry it
  either has a fix or an explicit renewal. The list's size is in every audit
  receipt, so it cannot grow unseen.

## Consequences

**Gets faster.**

- The land stage drops from minutes (p50 669 s measured) to the cost of a fetch,
  a lookup and a push. Under 5 s is the target and slice 2 measures it.
- Agents enqueue and continue. They no longer hold the lease for the length of
  the suite, and the lease starvation of B136 ends because ordering moves into
  the queue.
- Identical inputs are verified once. Re-verifying on an unchanged base (a
  retry, or entries behind an ejected one whose own inputs did not change)
  re-runs only the gates whose keys changed. Because base and history dependence
  is the default (decision 3), most gates still re-run when main or the commit
  history changes. The cache pays off as gates opt in to `baseIndependent` and
  pass audits, so its benefit starts small and grows with that work.
- One verifier runs heavy suites one lane at a time, so the self-starvation and
  collisions of today's concurrent lands on one machine are designed out.

**Gets slower or riskier. Stated plainly:**

- **Time to main is not 5 s.** A branch still waits for its own verification, so
  first-time-on-main for a code change is about one verification (minutes, the
  ~5 min floor measured above) plus its queue position. The 5 s is the land
  stage, not the end-to-end latency, and receipts report both.
- **Queue throughput is bounded by whole-repo and base-dependent gates.** They
  are invalidated whenever main moves, so each landed code change re-runs them for every entry
  behind it. At the measured 250-550 s for DreamShip's sensors gate, a serial
  queue lands roughly 7-14 code changes an hour. Batching (decision 2) is the
  mitigation; a faster sensors gate is the real fix.
- **Ejection costs re-verification.** A failure at position `j` re-verifies
  every entry behind it. The cache limits this to changed keys, but it is still
  real work.
- **The cache is a new way to be wrong.** An under-declared input lets a stale
  pass land. The audit run and sampled re-execution detect it after the fact,
  not before. That window is the price of the cache.
- **The evidence store is a new trust surface.** Anyone who can write a record
  can satisfy C2, much as anyone can forge the marker today. It does not weaken
  the default-closer, but it adds a second thing to protect.
- **The preview no longer gates.** A change that builds and passes every gate
  but fails to boot reaches main and is caught minutes later, not before.
- **A new failure domain.** A remote worker that is down or out of memory stops
  verification for everyone. The `--local` fallback keeps landing possible, at
  today's speed.

**Preserved.** ADR-0033's engine, scopes, apply modes, `requires`, tree
cleanliness check, observed success, exit codes and guards. `land.config.json`
stays consumer-owned. The migration is additive: each slice below lands alone.

## Details

### Migration, in slices

Each slice can be landed and measured on its own. None lowers a numeric
threshold; slices 4 and Q carry the two deliberate acceptance changes named in
C3.

| # | Slice | Done when | Measured by |
|---|---|---|---|
| 1 | Gate input declarations (`inputs`, `versions`, `wholeRepo`, `cache`) and the persistent evidence store keyed on them, used by today's land: `inheritUnaffectedEvidence` reads and writes the store across runs. Ships with the audit run and its comparison, and caching stays off by default until one audit run is clean. | A land whose gates' keys are unchanged skips them, and an audit run reports zero mismatches. | Per-step `cacheHit` and `key` in `runs.jsonl`; hit rate per gate; audit mismatches. |
| 2 | Land checks evidence only. `just verify <ref>` (today's land, minus the push) produces `C` and its evidence; `just land` does decision 1 (compare-and-swap push from a push checkout, already-landed outcome) and refuses when evidence is missing. Land reads the required set from the base `B` and refuses unapproved `policyFiles` changes (decision 4). `versioning-release-check` joins `PROTECTED_JOBS` and fails closed at push, with consumer configs migrated in the same change. | Land on a verified ref succeeds without running a gate. | `stage: "land"` `totalSeconds` p50/p90 against the 5 s / 5 min / 20 min budgets. |
| 3 | Queue worker behind the worker and evidence-store ports, local adapter in the template: FIFO, speculative trees, ejection and re-verification, rebasing on outside main moves. | Two queued branches land in order; an injected failure ejects one and the other still lands. | `stage: "queue"`: enqueue-to-landed seconds, ejections, re-verifications, queue depth. |
| 4 | Preview moved post-land, with teardown owned by the post-land runner. | No `landing-evidence`-style step in any `stage: "land"` or `"verify"` receipt. | `stage: "postland"` duration and red rate. |
| Q | Quarantine list and the non-required `quarantine` gate. Independent of 1-4. | A flaky test can be quarantined with an issue id and leaves after N audit passes. | List size and retry-pass count per audit receipt. |

### How to measure

`runs.jsonl` gains a `stage` field (`verify`, `land`, `queue`, `audit`,
`postland`), and each step gains `cacheHit` and `key`. Existing fields keep
their meaning. The budget is read from `stage: "land"` lines:
`jq -s 'map(select(.stage=="land")) | map(.totalSeconds) | sort'`. Time to main
is read from `stage: "queue"` lines. The baseline is the table in Context,
measured before slice 1.

### Alternatives considered

1. **Status quo plus deduplication.** Keep ADR-0033 and keep removing waste, as
   DreamShip's suite dedup did (1186 s to 302 s). This is worth doing anyway,
   but its floor is the duration of the real suites, about 5 minutes, which is
   the operator's bare minimum, not the target. It also keeps land serialized
   behind one lease on the agent's own machine.
2. **Per-branch CI (GitHub Actions or similar).** Verify each branch on push.
   It is out of budget for the consumers this engine serves (ADR-0022's route
   assumes paid Actions and branch protection). It also verifies against a stale
   base: two individually green branches can still break main together, which is
   exactly the problem a merge queue solves. GitHub's own merge queue needs both
   Actions and branch protection.
3. **Trust the branch's own pre-push.** Accept the developer's local hook run as
   evidence. It ran on a different base, often on a loaded workstation, can be
   skipped with `--no-verify`, and its result is not bound to the tree that
   lands. It would satisfy none of C1-C3.
4. **A build system with remote caching (Bazel-style action keys).** Correct by
   construction for declared actions, but a migration of every gate into a new
   build graph. The input-key design here borrows its idea (key on content plus
   tool versions) without the migration.

### Prior art

- Graydon Hoare, "The Not Rocket Science Rule Of Software Engineering" (2014):
  automatically maintain a repository of code that always passes all tests;
  bors, its implementation for Rust. https://graydon2.dreamwidth.org/1597.html
- bors-ng: queue, batching, and bisect-on-failure. https://bors.tech/
- GitHub merge queue: speculative merge groups over the queue head.
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- Zuul gating: dependent pipelines test each change with the changes ahead of
  it and re-test on failure. https://zuul-ci.org/docs/zuul/latest/gating.html
- Ananthanarayanan et al., "Keeping Master Green at Scale", EuroSys 2019
  (Uber's SubmitQueue): speculative verification of queued changes.
- Bazel remote caching (actions keyed on input digests and the command):
  https://bazel.build/remote/caching. Turborepo task hashing:
  https://turbo.build/repo/docs/crafting-your-repository/caching
- Flaky test quarantine: Martin Fowler, "Eradicating Non-Determinism in Tests"
  (2011); John Micco, "Flaky Tests at Google and How We Mitigate Them" (2016).

### Consumer follow-ups: known gaps in DreamShip's required gate set

The engine cannot close these; DreamShip's `land.config.json` and task graph
must. Tracked under DreamShip epic `dreamship-v0-luyfr`:

- `sy576`: `ws_apps/dream-ship-engine` is absent from the turbo task graph.
- `9pi2`: `just land` never runs the Rust tests.
- `l495j`: the engine's Rust tests run in no gate.
- `vxsrf`, `q7ds`: no gate runs the data layer's `--features esp` tests or
  doctests.
- `0iy`: render correctness (the render testing harness) is not a gate.

### Open questions for DreamShip (not resolved here)

1. **Verifier memory.** The intended verifier is the tower. It has 15 GB RAM, is
   not provisioned for this (`1kqv7.8.10`), shares the host with previews
   (`d9i5g`), and the agent-session server on it was OOM-killed twice on
   2026-10-09 (`bbusq`). Can it run the heavy lane, the previews and agent
   sessions at once, and with what memory limits and `parallelGates`?
2. **GPU gate placement.** Some render gates need a GPU (the macOS Metal gate
   today, the tower's GPU once provisioned). Which required gates run where,
   and can a gate that only one host can run be required when that host is not
   the verifier?
3. **Where the evidence store lives**, and who may write to it, once the worker
   is not the machine that lands.

The operator's Mac is not the verifier, and GitHub Actions is out of budget;
both are constraints, not open questions.
