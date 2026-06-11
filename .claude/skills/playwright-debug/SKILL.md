---
name: playwright-debug
description: Drive your app via Playwright for UI debugging: navigation, console errors, network failures, accessibility-tree DOM snapshots, JS evaluation. Use when investigating UI bugs, validating fixes, or capturing what the user sees.
---

# Playwright debugging recipes

## Setup

Playwright is installed at the workspace root (`playwright` devDep). The bundled Chromium is at `~/Library/Caches/ms-playwright/` (macOS) or `~/.cache/ms-playwright/` (Linux). Run `npx playwright install chromium` once per machine.

The harness exposes your running web app at `http://localhost:$WEB_PORT`. Get the port from `just stack inspect` (the `stack-manager` slot's JSON output includes `{ project, ports: { ... } }`).

## One-shot script pattern (token-efficient)

Write a small `.mjs` script that does ONE thing and outputs structured JSON. The agent calls it with `node`, ingests stdout, moves on. Avoid REPL-style sessions — they bloat context.

## Recipe: navigate and inspect DOM via locators

> NOTE: Playwright removed the `page.accessibility.snapshot()` API in v1.50+.
> Use role-based locators instead — they return a compact, structured view
> of the page's interactive elements.

```js
import { chromium } from 'playwright';
const [url] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });

// Enumerate interactive elements by role
const buttons = await page.getByRole('button').all();
const links = await page.getByRole('link').all();
const inputs = await page.locator('input, textarea, select').all();

const items = [];
for (const b of buttons) items.push({ role: 'button', name: await b.textContent() });
for (const l of links) items.push({ role: 'link', name: await l.textContent(), href: await l.getAttribute('href') });
for (const i of inputs) items.push({ role: 'input', name: await i.getAttribute('name') || await i.getAttribute('placeholder') });

console.log(JSON.stringify(items, null, 2));
await browser.close();
```

For a snapshot of just visible text without HTML noise, use `await page.locator('body').innerText()`. For specific regions, scope to a selector first.

## Recipe: capture console errors

```js
import { chromium } from 'playwright';
const [url] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push({ text: m.text(), location: m.location() }); });
page.on('pageerror', e => errors.push({ text: e.message, stack: e.stack }));
await page.goto(url, { waitUntil: 'networkidle' });
console.log(JSON.stringify(errors, null, 2));
await browser.close();
```

## Recipe: capture failed network requests

```js
import { chromium } from 'playwright';
const [url] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];
page.on('requestfailed', r => failures.push({ url: r.url(), method: r.method(), error: r.failure()?.errorText }));
page.on('response', r => { if (r.status() >= 400) failures.push({ url: r.url(), status: r.status(), method: r.request().method() }); });
await page.goto(url, { waitUntil: 'networkidle' });
console.log(JSON.stringify(failures, null, 2));
await browser.close();
```

## Recipe: click a thing, wait for a thing

```js
import { chromium } from 'playwright';
const [url] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
await page.getByTestId('new-task-input').fill('Diagnose 500');
await page.getByTestId('create-task').click();
await page.getByText('Diagnose 500').waitFor();
console.log('OK');
await browser.close();
```

Prefer `getByRole` / `getByTestId` over CSS selectors — same locator works regardless of DOM shape changes.

## Recipe: take a screenshot

See `.claude/skills/before-after-evidence/SKILL.md` for the screenshot-pair pattern. For ad-hoc snapshots:

```js
await page.screenshot({ path: '.harness/artifacts/<iso>/adhoc.png', fullPage: false });
```

## When to escape to raw CDP

For perf traces, source-mapped console stacks, heap snapshots, or low-level network event filtering, see `.claude/skills/chrome-devtools-deep/SKILL.md`. Reach for it via `page.context().newCDPSession(page)` so you stay in one Playwright session.

## Trace correlation

When you catch a failed `response` in Playwright, the request the browser made carries a `traceparent` header. Pull it from `response.request().headers()['traceparent']`, extract the trace_id (the second hex segment), and query VictoriaTraces:

```sh
curl -s "http://localhost:$VT_PORT/select/jaeger/api/traces/$TRACE_ID" | jq .
```

Then cross-reference with VictoriaLogs to get the error message — **always project fields** to avoid 10× token bloat:

```sh
curl -s "http://localhost:$VL_PORT/select/logsql/query" --data-urlencode \
  "query={harness.iso_key=\"<key>\"} trace_id:$TRACE_ID | fields _time, _msg, severity, req.url, res.statusCode | limit 5"
```

The `| fields …` projection is essential — without it each line returns ~2300 bytes; with projection ~200 bytes. The field name for log level is **`severity`** (not `level`). LogsQL has no `|~` regex pipe — use `field:/regex/` or bare `"word"` for text match. See the `observability-queries` skill (`.claude/skills/observability-queries/SKILL.md`) for the full LogsQL / PromQL / TraceQL query reference.
