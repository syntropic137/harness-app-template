#!/bin/sh
# ADR-0033. A lefthook `scripts:` entry, not a `commands:` entry, on purpose: lefthook
# skips every pre-push COMMAND with "(skip) no matching push files" when its push-file
# set is empty, and a script is exempt from that skip. git's pre-push args
# (<remote> <url>) and ref lines (stdin) pass straight through.
exec bun run scripts/push-scope-guard.ts "$@"
