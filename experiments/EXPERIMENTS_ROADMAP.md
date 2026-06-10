# Harness pressure-test lab: experiment roadmap

## Mission
Pressure-test whether the APSS-integrated harness (this fork, branch
feat/apss-integration) gives a FRESH agent EVERYTHING it needs to self-serve the
full dev loop: run the app, get fast feedback through the UI and the backend,
access OpenTelemetry, and find the how-to in AGENTS.md + the installed skills
right there in the repo. We are testing the adopter experience, not building
features. Fork-and-it-just-works is the bar.

## Protocol (MANDATORY)
Follow the running-experiments protocol:
https://github.com/AgentParadise/agentic-primitives (the running-experiments skill).
For EACH experiment:
1. Write experiments/EXP-NN-<slug>.md with a FROZEN hypothesis + explicit
   prediction, and COMMIT it BEFORE running any probe.
2. Run the probes. Capture observed output (paste real output, not vibes).
3. Write the verdict scored against the frozen prediction: CONFIRMED / FALSIFIED
   / PARTIAL. Negative results are committed with the same care as positive.
4. Annotate reusable empirical claims with evidence counts, e.g. "(N=1, low)".
5. Commit + push + announce in Agent Mail + move to the next open EXP number.
Shared FRICTION.md: append every friction item tagged tooling-bug / docs-gap /
config / workaround-found. Sole-editor per EXP file; do not edit another agents EXP.

## The experiments (claim the next open number; aim for 12+)
- EXP-01 fork-bootstrap: a clean checkout + `just bootstrap` succeeds and a first
  trivial commit passes the APSS doc gate (no "APSS binary not found"). This is
  the keystone adopter promise.
- EXP-02 run-the-app: using ONLY AGENTS.md + skills, can you start the app
  (frontend + backend) and reach it? Time it. What was missing or guessed.
- EXP-03 fast-feedback-loop: change a backend response, observe it; change a UI
  element, observe it. How discoverable + how fast is the inner loop.
- EXP-04 UI feedback: drive the running UI (browser automation skill if present)
  and confirm an observable assertion. Can an agent SEE the frontend.
- EXP-05 backend feedback: hit the API directly, read structured responses; is
  there a documented way an agent finds the endpoints.
- EXP-06 OpenTelemetry access: find and query traces/metrics/logs; use a trace
  to diagnose a deliberately introduced slow path. Is OTel actually reachable +
  documented for agents.
- EXP-07 AGENTS.md completeness: as a fresh agent, list every question you had to
  answer by guessing or reading source rather than from AGENTS.md/skills. Score
  the self-sufficiency gap.
- EXP-08 skills discoverability: which installed skills exist, do the relevant
  ones fire for harness tasks, and are any obviously missing.
- EXP-09 doc-gate in practice: trigger a real documentation-standard violation and
  confirm the gate blocks/guides correctly (note: gate is currently warnings-only
  in practice, 0 errors 37 warnings; test whether an error-severity case blocks).
- EXP-10 fitness-gate in practice: trigger a fitness regression (coupling/complexity)
  and confirm the sensors-gate gives actionable feedback.
- EXP-11 profiling-gap: can an agent profile API latency + frontend performance
  with what ships in the harness today? Predict NO. This experiment FEEDS the
  profiling-slot design task; capture exactly what is missing.
- EXP-12 end-to-end task: give yourself a small real feature ("add an endpoint +
  a UI element that calls it") and self-serve the WHOLE loop (code -> run -> UI +
  backend feedback -> telemetry -> gates green). Where did the harness carry you
  vs leave you stuck.

## Deliverable
One EXP-*.md per experiment + FRICTION.md, all committed and pushed. The
orchestrator aggregates learning lessons at wind-down. No em or en dashes.
