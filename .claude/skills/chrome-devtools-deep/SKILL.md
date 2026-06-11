---
name: chrome-devtools-deep
description: Reach for raw Chrome DevTools Protocol when Playwright's high-level API isn't enough: performance traces, source-mapped console stacks, heap snapshots, deep network introspection. Stay inside Playwright via `newCDPSession` rather than running raw websocat.
---

# Chrome DevTools Protocol — escape hatch

## When to use this skill

Use this only when `playwright-debug` can't get you what you need. Specific cases:
- Performance profiles (Tracing.start/stop)
- Source-mapped stack traces with original filenames
- Heap snapshots / memory leak diagnosis
- Filtering network responses by body content
- Throttling network or CPU
- Reading shadow DOM beyond Playwright's accessor

## Get a CDP session via Playwright

Stay in one tool. Don't shell out to websocat.

```js
import { chromium } from 'playwright';
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

await cdp.send('Network.enable');
await cdp.send('Page.enable');
// ... your CDP commands ...
```

## Recipe: performance trace of a user flow

```js
const cdp = await context.newCDPSession(page);
await cdp.send('Tracing.start', {
  categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
  transferMode: 'ReturnAsStream',
});
// ... do the flow ...
const { stream } = await cdp.send('Tracing.end');
// Then collect via IO.read until eof
```

Save the resulting trace JSON; open it in chrome://tracing or feed sections to the agent.

## Recipe: source-mapped console stack traces

```js
const cdp = await context.newCDPSession(page);
await cdp.send('Runtime.enable');
cdp.on('Runtime.exceptionThrown', e => {
  console.log(JSON.stringify(e.exceptionDetails, null, 2));
});
```

The `exceptionDetails.stackTrace.callFrames[].url` and `lineNumber` will be source-map-resolved if the page ships maps.

## Recipe: get network response body by URL pattern

```js
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
const interesting = new Map();
cdp.on('Network.responseReceived', e => {
  if (e.response.url.includes('/tasks')) interesting.set(e.requestId, e.response.url);
});
// Later, after the request completes:
for (const [requestId, url] of interesting) {
  const body = await cdp.send('Network.getResponseBody', { requestId });
  console.log(url, body.body);
}
```

## Recipe: heap snapshot

```js
const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
const chunks = [];
cdp.on('HeapProfiler.addHeapSnapshotChunk', c => chunks.push(c.chunk));
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
const snapshot = chunks.join('');
// Save to .harness/artifacts/<iso>/heap-<timestamp>.heapsnapshot
// Open in Chrome DevTools Memory panel
```

## Anti-recipe: don't run raw websocat

Raw CDP via `websocat`/`curl` was an earlier approach. It's been removed because (a) every response is unfiltered protocol JSON (token-heavy), (b) error messages are numeric codes, (c) you lose Playwright's frame/target management. Use `newCDPSession()` instead.
