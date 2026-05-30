---
name: before-after-evidence
description: Produce a verifiable evidence bundle for a fix — screenshot pair, optional flow recording, ffmpeg keyframe grid, trace correlation. Use when claiming "fix verified" so the artifacts can be diffed by a reviewer (human or LLM).
---

# Before/after evidence capture

## The artifact contract

Every "fix verified" claim produces a directory `.harness/artifacts/<iso_key>/` with:

```
meta.json             { run_id, branch, fix_commit, target_url, started_at, finished_at }
screenshots/
  before.png          full-fidelity archive
  before.jpg          1280×720 JPEG quality 80 (for LLM ingestion)
  after.png
  after.jpg
video/                (only if a flow recording was taken)
  flow-before.webm
  flow-after.webm
  events-before.jsonl   console + network events with timestamps
  events-after.jsonl
review/               (only if a keyframe grid was generated)
  keyframe-grid-before.jpg   ffmpeg tile montage, single JPEG
  keyframe-grid-after.jpg
trace-correlation.md  list of failed requests → trace_ids → VictoriaTraces links
```

`<iso_key>` is the per-worktree key from `pnpm harness inspect`.

## Recipe A: screenshot pair (sufficient for 80% of UI fixes)

Use `harness/agent-tools/screenshot-pair.mjs`:

```sh
node harness/agent-tools/screenshot-pair.mjs --phase=before --url=http://localhost:$WEB_PORT
# ...apply fix, redeploy via hot reload...
node harness/agent-tools/screenshot-pair.mjs --phase=after --url=http://localhost:$WEB_PORT
```

The script writes PNG (full fidelity) + JPEG (LLM-optimized) to `.harness/artifacts/<iso>/screenshots/`.

## Recipe B: flow recording with keyframe grid (for animation/transition/loading-state bugs)

Use `harness/agent-tools/record-flow.mjs`:

```sh
node harness/agent-tools/record-flow.mjs --phase=before --url=http://localhost:$WEB_PORT --flow=task-crud
# ...apply fix...
node harness/agent-tools/record-flow.mjs --phase=after --url=http://localhost:$WEB_PORT --flow=task-crud
```

The script does: open browser → record screencast → run the named flow → stop recording → ffmpeg extract 3×3 keyframe grid → write `events.jsonl` from console + network listeners.

LLM consumption: send the **keyframe grids** (1 JPEG each, ~2.7K tokens) plus the **screenshot pair**, NOT the WebM. Total budget ~8K vision tokens per validation.

## Recipe C: trace correlation

For every failed request captured in `events.jsonl`, extract the `traceparent` header and produce a `trace-correlation.md`:

```sh
# Pseudocode the agent runs
for failure in events.jsonl where type==network and status>=400:
  trace_id = extract_trace_id(failure.traceparent)
  trace = curl http://localhost:$VT_PORT/select/jaeger/api/traces/$trace_id
  append to trace-correlation.md:
    - URL, method, status
    - trace_id
    - Backend span that failed (look for span with status="ERROR")
    - Error message from the span attributes
```

This is the highest-leverage debug bridge — browser-visible failure to backend-resolved root cause.

## Decision matrix: which recipe to use

| Bug type | Recipe |
|---|---|
| Static UI difference (text, color, layout) | A (screenshot pair) |
| Modal/toast/form interaction | A (screenshot pair, post-action) |
| Animation, transition, loading state | B (recording + keyframe grid) |
| Backend 4xx/5xx caused by frontend | A + C (screenshots + trace correlation) |
| Performance regression | See `chrome-devtools-deep` for Tracing.start |

## Reporting template

Output the final validation report to `.harness/artifacts/<iso>/REPORT.md`:

```markdown
# Fix validation: <bug-id>

**Branch:** <branch>
**Fix commit:** <sha>
**Target:** http://localhost:<port>

## Before
![](screenshots/before.jpg)

## After
![](screenshots/after.jpg)

## Trace correlation
<contents of trace-correlation.md if present>

## Verdict
<pass | fail | uncertain>
<one-paragraph rationale>
```
