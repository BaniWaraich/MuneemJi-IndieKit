---
id: MODULE_ID            # e.g. D02
name: module-slug        # e.g. statement-format-extraction
status: DRAFT            # DRAFT | SPECCED | IMPLEMENTED | STABLE | PLANNED | DEPRECATED
owners: []               # agents/people responsible (e.g. ["worker", "schema"])
last_updated: YYYY-MM-DD
---

# MODULE_ID — Human Module Name

> One-paragraph elevator pitch. What this module is, why it exists, how it relates to adjacent modules. A reader who has not seen the rest of the codebase should be able to place this module in the system after reading this paragraph.

---

## Status

`DRAFT | SPECCED | IMPLEMENTED | STABLE | PLANNED | DEPRECATED`

- **DRAFT** — being written; do not implement.
- **SPECCED** — module doc is complete and approved by Bani; implementation may begin. **This is the gate.**
- **IMPLEMENTED** — code shipped against the spec; behaviour matches.
- **STABLE** — production-soaked; changes require a spec amendment.
- **PLANNED** — known module, not yet specced. Implementation forbidden.
- **DEPRECATED** — superseded; do not extend, plan removal.

If status is anything other than `SPECCED`, `IMPLEMENTED`, or `STABLE`, no code may be written for this module.

---

## 1. Purpose

What problem does this module solve? Three to five sentences max. Avoid restating the elevator pitch.

---

## 2. Inputs and Outputs

**Inputs**
- _Describe every input: shape, source, validation guarantees the module relies on._

**Outputs**
- _Describe every output: shape, destination (DB row, queue job, HTTP response, file)._

State explicitly what this module does NOT produce. The boundary is as important as the surface.

---

## 3. Trigger Mechanism

How is this module invoked? Pick one or more:
- API route call (list routes)
- Queue job consumed (queue name + job shape)
- Cron / scheduled event
- Direct function call from another module (caller list)

---

## 4. Schema Tables Owned

Every table this module is the **sole writer** of. List columns whose semantics are owned by this module even if the table is shared.

If this module reads from tables owned by other modules, list those under "Reads (shared with: M__)" — never under "Owned".

| Table | Ownership | Notes |
|---|---|---|
| `<table>` | sole writer | |
| `<table>` | shared writer with M__ | which columns we own |
| `<table>` | reader only | owned by M__ |

---

## 5. API Contracts

For each route owned by this module:

### `METHOD /api/v1/path`

- **Auth:** which session type(s) accepted; which org scope is enforced
- **Request body / params:** typed schema
- **Response:** success shape + status code
- **Errors:** the specific application error codes returned (and what produces each)

If this module exposes no HTTP routes, state so explicitly.

---

## 6. Queue Jobs

**Publishes**
- `queueName.eventName` — `{ payload shape }` — when emitted, who consumes

**Consumes**
- `queueName.eventName` — `{ payload shape }` — what this module does with it
- Concurrency, attempts, backoff
- Idempotency key (jobId pattern) and dedupe rules

If this module does not interact with queues, state so.

---

## 7. Business Logic Rules

The non-obvious rules that govern this module's correctness. Each rule should be testable.

- _Every rule one bullet. Tie each to a specific failure if violated._

---

## 8. LLM Usage

If no LLM is used, write "None." and skip the rest.

For each call:

- **Provider / model:** e.g. Claude Opus 4.6 / GPT-4o mini
- **When invoked:** trigger condition + frequency
- **Inputs:** what goes into the prompt (size estimate in tokens)
- **Output schema:** exact shape expected back
- **System prompt:** verbatim, fenced
- **Retries / fallback:** attempt count, fallback behaviour, integrity checks
- **Temperature, max_tokens, timeout:** explicit values
- **Data compliance:** any zero-retention or PII requirements

---

## 9. Economics

Cost per invocation. Tie to PRD §21 (Unit Economics) when relevant.

| Component | Per unit | Frequency | Notes |
|---|---|---|---|
| _LLM call X_ | $0.00 | per invocation | |
| _Storage_ | $0.00 | per item | |
| _Compute_ | $0.00 | per call | |

State the watch metric (e.g. "cache miss rate above 30% requires investigation").

---

## 10. Failure Modes

For each failure mode the module can produce:

| Failure | Trigger | Impact | Severity | Recovery |
|---|---|---|---|---|
| `ErrorClassName` | what causes it | what users see | low/med/high/critical | retry / manual / unrecoverable |

Cover at minimum: upstream dependency outages, validation failures, integrity check failures, rate-limit / quota exhaustion, timeouts.

---

## 11. Dependencies

- **Depends on (modules):** _list module IDs this module needs to function._
- **Depended on by (modules):** _list module IDs that consume this module's outputs._
- **External services:** _AWS S3, ClamAV, Anthropic, OpenAI, etc._

---

## 12. Open Questions

Anything specced as TBD. Keep this section honest — open questions block `SPECCED` status.

---

## 13. Change Log

| Date | Change | By |
|---|---|---|
| YYYY-MM-DD | Initial draft | name |
