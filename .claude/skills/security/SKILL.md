---
name: security
description: "Use when reviewing security concerns: secrets in code, SAST coverage, input validation, authn/authz boundaries, sensitive-data handling, dependency CVEs, SSRF, hand-rolled escaping, threat modeling for high-stakes changes, defense in depth, agentic-AI / LLM tool-call attack surface (prompt injection, indirect injection, MCP abuse)"
---

# Security

## Overview

Security is the discipline that asks who can reach this code, with what input, and what they can do once they are inside. Done well, secrets live in a managed store, input is validated at the edge, authorization is centralized, sensitive data does not leak through logs or errors, and outbound calls cannot be coerced into reaching internal services. Done poorly, a single missed boundary or a hardcoded credential is enough to lose the customer database.

**Core principle:** Trust boundaries are explicit, decisions are centralized at them, and every input crossing them is validated. Security failures are the ones the codebase forgets to make explicit.

## Core Principles

### 1. Secrets do not live in source

API keys, tokens, private keys, passwords, and connection strings with embedded credentials never live in tracked files, including `.env` files that fail to make it into `.gitignore`. A secret in git history is compromised the moment the repo is read; rotation is the only remediation, and scanners harvest public hosting continuously.

**Multiple valid secret stores exist:** centralized secret manager, cloud-provider native, envelope-encrypted files. The principle is: secrets live in a managed store, not in source. The red flag is "secret in source," not "did not use a particular vendor." See the [`configuration`](../configuration/SKILL.md) skill for how secrets and non-secrets share (or do not share) a namespace. Cross-reference: the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill carries the deploy-time credential-scoping and rotation stance that consumes these stored secrets at release time.

### 2. Static analysis runs in CI (scope: projects with CI)

This principle scopes to projects with a CI pipeline. When the scope applies: a static-analysis pass with security rules runs on every PR. Humans miss patterns that machines catch deterministically: tainted-flow violations, unsafe deserialization, weak crypto choices, dangerous defaults. Without a SAST gate, every PR relies on every reviewer remembering every class of bug.

**Multiple valid SAST stacks exist:** a single general-purpose tool, a stack of language-specific tools, or a managed service. The principle is: a SAST gate is present in CI; the choice between stacks depends on language mix and maturity.

### 3. Use parameterization, not hand-rolled escaping

String concatenation or interpolation building a SQL query, an HTML response, an LDAP filter, a shell command, or a template, with user-controlled values, is injection waiting to happen. Use the platform's parameterization API (prepared statements, contextual auto-escaping templates, argv-style command invocation), not string concatenation.

In-repo `escapeYaml`, `escapeJson`, `escapeSql`, `escapeHtml`, or `escapeShell` helpers with bespoke quoting logic are a closely related red flag. An escape function encodes the assumption that the author understands every edge case the target format admits; YAML (block vs flow scalars, anchors, tags) and shell (word splitting, glob, history expansion) are particularly hostile to this assumption. Use a parser/serializer library that round-trips through the format's grammar.

### 4. Centralize authorization at trust boundaries

Authorization checks live at a single chokepoint (middleware, policy layer, framework guard), not sprinkled ad hoc through views and handlers. Scattered auth logic is how broken access control happens: an endpoint added without remembering the check, or two endpoints implementing the same authorization with two different rules.

### 5. Redact sensitive data before it reaches logs and error responses

Log statements and error handlers are exfiltration channels: they propagate into systems with broader read access (log aggregators, support tools, backups) where the original access controls do not apply. Email addresses, government IDs, full credit-card numbers, auth tokens, and session cookies must be redacted at the boundary; error responses to clients must not echo user input or stack traces unredacted.

This principle scopes to data classified as sensitive under the project's data-classification policy. Cross-reference the [`logging`](../logging/SKILL.md) skill for the redaction-at-the-boundary mechanic.

### 6. Gate dependency CVEs in CI

A CI step that scans the resolved dependency tree against an advisory database is non-negotiable. The runtime-attack side of the same gate the [`dependencies`](../dependencies/SKILL.md) skill carries from the supply-chain side: a known, cataloged, two-months-old CVE that nobody's automated gate caught is the canonical breach pattern.

### 7. Constrain outbound requests built from untrusted input (SSRF)

When an outbound HTTP request URL is influenced by user input, remote content, or a redirect target, the server can be coerced into reaching internal services (cloud metadata endpoints, internal admin APIs) or attacker-controlled hosts. Outbound calls with untrusted URL components require an allowlist on host or scheme and a block on internal IP ranges (RFC 1918, link-local, loopback).

**Multiple valid allowlist scopes exist:** host-based, scheme-based, IP-class-based, or a combination. The principle is: untrusted URL components are constrained at the call site, not "we used a sensible URL parser." The choice depends on what the call legitimately needs to reach; a more permissive allowlist requires a stronger justification.

### 8. Threat-model high-stakes changes (scope: new external interfaces, auth flows, data classifications, third-party integrations)

This principle scopes to changes that introduce a new external interface, a new authentication flow, a new data classification, or a new third-party integration. When the scope applies: a STRIDE-style or attack-tree analysis is attached to the design. Security decisions made implicitly are security decisions that nobody owns; threat modeling at design time is the cheapest place to discover that the proposed authentication is replayable or the new endpoint is missing rate limiting.

The artifact answers Shostack's four questions: **(1) What are we working on?** (the system or change being reviewed); **(2) What can go wrong?** (STRIDE: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege; or an attack tree); **(3) What are we going to do about it?** (mitigations per identified threat); **(4) Did we do a good enough job?** (review the artifact, validate the mitigations land in the design and tests). The four questions are the operational form of the principle; STRIDE is one of several ways to answer question 2.

### 9. Defense in depth: no single control is sufficient; layers compose

Every other principle in this SLP closes one class of failure. The framing principle is: assume each individual control will eventually fail (a misconfiguration, a missed PR review, a novel bypass) and design so the next layer catches the failure. The secret manager plus the SAST scan plus the centralized auth plus the SSRF allowlist plus the redacted logs is not redundancy; it is the property that any single failure stays bounded.

The corollary is that adding a new control is rarely a substitute for an existing one: a managed secret store does not retire the secret-detection pre-commit hook, a SAST gate does not retire the parameterization rule, a WAF does not retire input validation. Layers replace each other only with explicit deprecation and review.

This principle is also the design rationale for "least privilege everywhere" (NIST SP 800-53 AC-6): every credential, role, network policy, and trust boundary is scoped tighter than the worst-case need so a single compromised layer reaches less.

### 10. Agentic-AI / LLM tool-call attack surface (scope: systems that integrate LLMs or AI agents)

This principle scopes to systems that include an LLM in their request path, dispatch tool calls based on model output, or run AI agents over the codebase or production data. When the scope applies: the threat model treats the LLM as an *untrusted interpreter of input*, not a trusted component, and applies the boundary disciplines from principles 3, 4, and 7 explicitly to the model-input and tool-call seams.

Three concrete classes:

- **Direct prompt injection.** User-provided text contains instructions that override the system prompt or coerce the model into actions outside its intended scope. Mitigation: do not trust the model to enforce policy that the surrounding system can enforce structurally (rate limits, allowlists, schema-validated tool calls, authorization checks centralized at the tool-dispatch layer per principle 4).
- **Indirect prompt injection.** Untrusted content the model reads (a fetched web page, a retrieved document, a dependency README, a code comment, an MCP resource) carries injected instructions. Mitigation: treat all model-readable external content as adversarial input; validate and constrain what the model can do based on tool-call schemas, not on what its output text claims; for agents reading a repo, scope filesystem and network access tightly.
- **MCP / tool-call abuse.** Tools exposed to the model run with the privileges of the process invoking them. A model coerced into calling `delete_file` or `run_shell` reaches whatever the tool reaches. Mitigation: tool surfaces follow least privilege (principle 9); destructive tools require explicit confirmation outside the model's control plane; tool inputs are schema-validated before execution.

The pattern composes with principle 1 (secrets do not live in source, including system prompts checked into a repo the model can read), principle 4 (centralize authorization; the tool dispatcher is a trust boundary), and principle 9 (defense in depth; the model is one layer, not the layer).

### 11. Mechanically enforce committed security rules as fitness functions (scope: rules the project commits to)

When the project commits to a specific security rule (no `eval` or `exec` outside an explicitly-marked sandbox directory, no string-concatenated SQL outside a `legacy/` boundary, no plaintext secrets in logs, no outbound calls without an allowlist), the rule belongs in CI as a fitness function: a script that fails the build when the rule is violated. A rule that lives only in `CONTRIBUTING.md` decays one PR at a time. The fitness-function pattern is the same shape adopted in `dependencies` (zero-runtime-dep checks, transitive-count caps) and `types` (escape-hatch detectors). Cross-reference: the [`architecture`](../architecture/SKILL.md) skill's [fitness-functions deep-dive](../architecture/fitness-functions/README.md) for the broader framing; this skill carries the security-specific instances.

## Red Flags - STOP

- Hardcoded secrets in source: API keys, tokens, private keys, passwords, connection strings with embedded credentials, or `.env` files outside `.gitignore`
- No SAST gate in a CI-equipped project; security rules absent from the lint/static-analysis pass
- String concatenation building SQL, HTML, LDAP, shell, or template output with user-controlled values; in-repo hand-rolled escape/quoting helpers used at injection boundaries
- Authorization checks done ad hoc inside views or handlers, with no centralized chokepoint; or two endpoints implementing the same authorization with two different rules
- PII, auth tokens, or session cookies in log statements; user input or stack traces echoed unredacted in error responses
- No CI step scanning the resolved dependency tree against an advisory database; known-CVE findings with no remediation plan
- Outbound HTTP calls with user-influenced URL components and no allowlist on host or scheme, no block on internal IP ranges (SSRF surface)
- New external interface, auth flow, data classification, or third-party integration shipped with no STRIDE-style threat-model artifact, or threat-model artifact present but Shostack's question 4 ("did we do a good enough job?") was never asked
- A single control treated as sufficient: "we have a secret manager, so we don't need detection"; "we have a WAF, so we don't need parameterization"; defense-in-depth stance is undocumented and any single failure has unbounded blast radius
- LLM-integrated system treats model output as trusted: tool calls executed without schema validation; system prompts assumed inviolable; agent loop given filesystem or network privileges beyond the task it's running; untrusted content fed to the model with no awareness of indirect-injection risk
- Project commits to a security rule (no `eval` outside sandbox, no string-concat SQL, etc.) but enforces it only via reviewer attention; no fitness function in CI catches the violation

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "The secret is in a private repo, it's safe" | Private becomes public via exfiltration, mistakes, or open-sourcing; rotation is the only remediation |
| "SAST has too many false positives" | Tune the rules; the alternative is human reviewers remembering every bug class |
| "Our escape function is fine; we wrote it carefully" | Escape functions encode every edge case of a hostile grammar; parser libraries round-trip them |
| "The auth check is right there in the handler" | And in forty other handlers, with three subtly different rules |
| "Logging the user object is just for debugging" | Debug logs ship to aggregators with weaker access control; the leak is durable |
| "We patch CVEs when we hear about them" | The Equifax patch was available for two months; the runtime cost was 147M records |
| "The URL parameter is fine; users wouldn't abuse it" | Capital One agrees in retrospect: 100M+ records via SSRF to the metadata endpoint |
| "Threat modeling is overhead for a small change" | Until the small change is the new auth flow that admits replay attacks |
| "We have layer X, that's enough" | Layer X will fail; the question is whether the next layer catches it |
| "The LLM has a system prompt telling it not to do X" | The model is an untrusted interpreter; structural controls beat polite instructions |
| "Indirect injection is theoretical" | Greshake et al. (2023) demonstrated it on production systems; treat retrieved content as adversarial |
| "The rule is in CONTRIBUTING.md, contributors will follow it" | One PR at a time, the rule decays; mechanically check it or remove it |

## Key Patterns

```
✅ Secret pulled from a managed secret store at runtime
❌ Secret hardcoded in source or committed in .env
```

```
✅ CI step: SAST scan with security rules on every PR
❌ Lint passes; no security rules; reviewer is the only gate
```

```
✅ db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
❌ db.execute(f"SELECT * FROM users WHERE id = {user_id}")
```

```
✅ require_role("admin") middleware on every admin route; one source of truth
❌ if user.is_admin: ... scattered across handlers with subtly different rules
```

```
✅ logger.info("login_attempt", user_id=user.id)  (PII redacted; ID only)
❌ logger.info(f"User {user.email} logged in with password {password}")
```

```
✅ CI step: advisory-database scan; PR fails on critical CVEs
❌ CVE check is a manual quarterly task that slipped last quarter
```

```
✅ httpx.get(url, ...) where url passes allowlist (scheme, host, not RFC1918)
❌ httpx.get(user_supplied_url) with no validation
```

```
✅ Plan attaches a STRIDE analysis for the new third-party integration
❌ New auth flow ships with no threat-model artifact; replay attack discovered later
```

```
✅ Tool dispatcher: schema-validates input, checks authorization, scopes filesystem/network per call; model output is data, not instruction
❌ Agent loop: model emits "shell: rm -rf $TARGET", harness executes with full privileges; no schema, no allowlist
```

```
✅ scripts/check-no-eval.mjs fails CI when `eval(` appears outside src/sandbox/; the rule is enforced, not aspirational
❌ CONTRIBUTING.md says "no eval"; reviewers occasionally catch it; PR #847 missed
```

## Why This Matters

Security failures are the failures the codebase forgets to make explicit. Every check above closes a class of incident that has already happened to someone, often famously. The cost of skipping them is paid not at write time but in incident response, regulatory exposure, and customer trust.

Without disciplined security practice:

- Secrets leak via git history, log aggregators, debug dumps, and committed `.env` files.
- Injection vulnerabilities accumulate at every interpreter boundary the codebase touches.
- Broken access control surfaces every time a new endpoint forgets the auth check.
- CVE breaches catch up to the team on the timetable of attackers, not maintainers.
- SSRF, mass assignment, and replay attacks succeed because the threat model was never explicit.

With disciplined security practice:

- Secrets live in a managed store; rotation is automatable; leakage is bounded.
- Parameterization makes injection structurally impossible at the boundaries that matter.
- Authorization is centralized; adding an endpoint inherits the check by default.
- CVE gates surface vulnerabilities on their patch timetable, not the attacker's.
- Threat-model artifacts make the security posture reviewable before code lands.

Cross-reference: the [`environments`](../environments/SKILL.md) skill carries the per-environment parity discipline that keeps the secret-loader and trust boundary uniform across dev, staging, and production so security posture does not silently weaken in one tier.

Cross-reference: the [`error-handling`](../error-handling/SKILL.md) skill carries the "messages are a contract" framing this skill pairs with at the error boundary; together they ensure error responses neither echo unsanitized input nor leak internals.

Cross-reference: the [`types`](../types/SKILL.md) skill carries the soundness side of boundary validation, refining untrusted input into a typed shape exactly once at the same seam this skill guards as an attack surface.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** secrets are not committed; obvious injection sites use parameterization. Awareness that the surface will need a SAST gate and CVE scanning as soon as users arrive.
- **Growing internal tool:** secret manager in use; SAST gate in CI; CVE scan on PRs; first auth chokepoint established. Logs are checked for PII at the boundary even if redaction is not yet automated.
- **Shared library:** library exposes no secrets, never logs caller-supplied secrets even if passed them, and documents the trust boundary. Released with provenance attestations.
- **Production service:** secrets in a managed store with automated rotation; SAST + CVE gates enforced in CI; centralized authorization with policy tests; PII redaction at the logger boundary; SSRF allowlists on every outbound call from untrusted input; threat-model artifacts for high-stakes changes; defense-in-depth stance documented; committed security rules backed by fitness functions in CI; for LLM-integrated systems, tool-call surfaces schema-validated, model output treated as data, indirect-injection risk reviewed for any retrieval surface.
- **Safety-critical:** independent security review; structured penetration testing; explicit control mappings (where the project operates under a compliance regime); audit logs separated from operational logs; tamper-evident audit trail; threat models reviewed and updated as the system evolves.

## References & rationales

- **CWE Top 25 (MITRE), specifically CWE-798 (Use of Hard-coded Credentials).** Backs principle 1 (secrets do not live in source). On the Top 25 because it is both common and trivially exploitable.
- **OWASP ASVS V2 (Authentication) and V14 (Configuration).** Back principle 1; require secrets to live in a managed store, not in source.
- **OWASP Top 10 (2021), A06 (Vulnerable and Outdated Components) and A04 (Insecure Design).** Back principles 2 (SAST in CI) and 6 (CVE gates). Both categories are reliably surfaced when SAST and dependency scanning are present, and silent when they are not.
- **OWASP Top 10 (2021), A03 (Injection).** Backs principle 3 (parameterization, not hand-rolled escaping). The canonical class of "untrusted input crosses an interpreter boundary."
- **Michal Zalewski, *The Tangled Web* (2011); Chris Anley, "Advanced SQL Injection in SQL Server Applications" (2002).** Back principle 3 from the hand-rolled-escape direction. Browser-side and SQL-side foundational examples of context-blind escaping failures.
- **OWASP Top 10 (2021), A01 (Broken Access Control); Adam Shostack, *Threat Modeling: Designing for Security* (2014).** Back principle 4 (centralize authorization at trust boundaries). The most prevalent category in the 2021 Top 10; trust-boundary analysis is the canonical framework for centralizing decisions.
- **NIST SP 800-53, controls AU-9 (Protection of Audit Information) and SI-11 (Error Handling).** Back principle 5 (redact sensitive data in logs and errors). The explicit pairing of log protection and error-message hygiene.
- **The 2017 Equifax breach (CVE-2017-5638, Apache Struts).** Backs principle 6 (gate dependency CVEs in CI). Two-months-old patch, cataloged CVE, no automated gate; 147M records.
- **OWASP Top 10 (2021), A10 (Server-Side Request Forgery); the 2019 Capital One breach.** Back principle 7 (constrain outbound requests). 100M+ records exfiltrated via SSRF to the EC2 instance-metadata endpoint.
- **Adam Shostack, *Threat Modeling: Designing for Security* (2014); NIST SP 800-53 control PL-8 (Security and Privacy Architectures).** Back principle 8 (threat-model high-stakes changes). STRIDE, the four-question framework ("What are we working on / What can go wrong / What are we going to do / Did we do a good enough job"), and the compliance contexts where it is mandated.
- **Saltzer and Schroeder, "The Protection of Information in Computer Systems" (1975); NIST SP 800-53 control AC-6 (Least Privilege).** Back principle 9 (defense in depth, least privilege). The foundational paper on protection-system design principles; the NIST control catalog operationalizes them in regulated contexts.
- **OWASP Top 10 for LLM Applications (2025).** Backs principle 10 (agentic-AI / LLM tool-call attack surface). The discriminated taxonomy of LLM-specific risks: prompt injection (LLM01), insecure output handling (LLM02), training-data poisoning, model denial of service, supply-chain via models, sensitive information disclosure, insecure plugin design, excessive agency, overreliance, model theft.
- **Kai Greshake, Sahar Abdelnabi et al., "Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection" (2023).** Backs principle 10 from the indirect-injection direction. Demonstrates that retrieved content (web pages, documents, MCP resources) can carry instructions that hijack the model.
- **Simon Willison's writing on prompt injection.** Backs principle 10 from the practitioner-summary direction. The framing that "the LLM is an untrusted interpreter" and that structural controls outside the model are the durable answer.
- **Building Evolutionary Architectures (Ford, Parsons, Kua, Sadalage).** Backs principle 11 (fitness functions for committed security rules). The mechanical-enforcement framing already adopted by the `dependencies` and `types` skills; cross-link to the [`architecture`](../architecture/SKILL.md) skill's deep-dive for the broader pattern.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **SAST (general):** Semgrep (rule-based, multi-language), CodeQL (semantic, deeper analysis), SonarQube (managed, multi-language).
- **SAST (language-specific):** Bandit (Python), gosec (Go), Brakeman (Ruby), ESLint security plugins (JS/TS), `cargo clippy` with security-relevant lints (Rust).
- **Secret detection:** gitleaks, trufflehog, GitHub secret scanning, pre-commit hooks that block on entropy patterns.
- **Secret stores:** centralized (e.g., HashiCorp Vault), cloud-provider native (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault), envelope-encrypted files (sops with age or KMS).
- **Dependency CVE scanning:** `pip-audit`, `npm audit`, `cargo audit`, `govulncheck`, OWASP Dependency-Check, Snyk, GitHub Dependabot alerts. Cross-reference: the [`dependencies`](../dependencies/SKILL.md) skill for the supply-chain side of the same gate.
- **Threat modeling:** STRIDE, attack trees, OWASP Threat Dragon, Microsoft Threat Modeling Tool. The artifact matters more than the tool.
- **SSRF defenses:** language-specific allowlist libraries (e.g., Python `httpx` with custom transport rejecting RFC 1918), egress proxies with policy enforcement, network policy at the orchestrator level.
- **Compliance frameworks:** OWASP ASVS for verification requirements; NIST SP 800-53 for control catalogs in regulated contexts.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/security/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
