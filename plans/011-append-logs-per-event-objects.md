# Plan 011: Make audit/usage logs append-safe (object-per-event)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/log-append.ts web/lib/usage-log.ts web/lib/vault-paths.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: MED (log.md is user-visible vault content; format must survive)
- **Depends on**: plans/004 (unit runner); read plans/007 for the rejected-alternative rationale
- **Category**: bug
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

Both audit trails append by read-modify-write of a single shared object:
`_system/log.md` (`appendLog`) and `_system/usage-log.jsonl`
(`logChatInteraction`). Concurrent writers lose each other's appends — the
audit trail silently drops entries. Both modules acknowledge this in comments
("Acceptable for single-user MVP"), so this is a *documented-tradeoff upgrade*,
not a hidden bug: fix it by writing one object per event (S3 PUTs of distinct
keys never conflict), keeping the existing aggregate files as derived views.

**Design note (why not ETag CAS like plans/007):** logs are pure appends with
high write frequency in exactly the scenarios that matter (chat turns, batch
curates); CAS would retry-storm. Object-per-event is conflict-free by
construction.

## Current state

- `web/lib/log-append.ts` (33 lines) — whole write path:

  ```ts
  const target = scope ?? (path ? inferScopeFromKey(path) : resolveScope({ scope: 'shared' }));
  const key = target.systemKey('log.md');
  let existing = '';
  try { existing = await getObject(key); } catch { /* fresh */ }
  const line = `- ${new Date().toISOString()} | ${action} | ${path} | "${title}"`;
  const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
  await putObject(key, content);
  ```

  Actions: `'created' | 'edited' | 'deleted' | 'curated'`. Callers: folders.ts,
  spaces.ts, docs routes, upload route, curate finalize — find all with
  `grep -rn "appendLog(" web/`.
- `web/lib/usage-log.ts` (55 lines) — same get→concat→put with a JSONL line;
  best-effort (failures warned + swallowed); caller: `web/app/api/chat/route.ts`.
- `_system/log.md` is **vault content the portal renders** (PRD lists `LOG.md`
  as a vault file; `isDocumentKey` excludes `log.md` and `log-*.md` filenames
  from indexing — `web/lib/vault-paths.ts:86-87` — note `log-*.md` is ALREADY
  reserved, which this plan exploits).
- Whoever reads `usage-log.jsonl` today: only plan-002's finding mentions it;
  `grep -rn "usage-log" web/` to confirm there is no reader in the app —
  it's an operator artifact.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| Unit      | `pnpm --filter @canopy/web test` | all pass |
| E2E       | `pnpm build && pnpm test:e2e` | all pass |

## Scope

**In scope**:
- `web/lib/log-append.ts`, `web/lib/usage-log.ts`
- `web/lib/__tests__/log-append.test.ts` (create)
- `docs/configuration.md` (one paragraph documenting the new log layout)

**Out of scope**:
- Every `appendLog`/`logChatInteraction` caller — signatures must not change.
- `web/lib/vault-paths.ts` — the `log-*.md` exclusion already exists; don't touch.
- Rendering/UI for logs; retention/cleanup policies (note as follow-up).
- The Lambda's own logging.

## Git workflow

- Branch: `advisor/011-append-safe-logs`
- Commit style: imperative, under 72 chars.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `appendLog` → one object per event

Rewrite the write path (same exported signature):

```ts
const ts = new Date().toISOString();
const rand = Math.random().toString(36).slice(2, 8);
const key = target.systemKey(`log/${ts.replace(/[:.]/g, '-')}-${rand}.md`);
const line = `- ${ts} | ${action} | ${path} | "${title}"`;
await putObject(key, `${line}\n`);
```

Notes: the `_system/log/` prefix is new; keys are `.md` but live under
`_system/` so `isDocumentKey` already excludes them from search/index/tree
(verify against `web/lib/vault-paths.ts:82` — `_system/` is excluded before
the filename checks). Do NOT delete or rewrite the existing `log.md` object —
history stays where it is.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: `logChatInteraction` → one object per event

Same pattern: `target.systemKey(\`usage/${tsSlug}-${rand}.json\`)`, body = the
single JSON entry (pretty or single-line — single-line, matching the current
JSONL line shape). Keep the best-effort try/catch + `console.warn`. Keys end
`.json`, not `.md`, so they can never enter document listings at all
(`listObjects` is `.md`-only).

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Unit tests

`web/lib/__tests__/log-append.test.ts` (mock S3 via `MOCK_S3=1`, reset
between tests — see plan 004/007 pattern):

- two rapid `appendLog` calls → TWO distinct keys under `_system/log/`, both
  bodies intact (the lost-append regression).
- scope routing: key under `users/<id>/_system/log/` when the doc key is
  user-scoped; shared otherwise.
- `logChatInteraction` writes under `_system/usage/`, body parses as JSON with
  the same fields as before (`ts, scope, userId, question, …`).
- no object named `log.md`/`usage-log.jsonl` is written by the new code.

**Verify**: `pnpm --filter @canopy/web test` → all pass.

### Step 4: Document the layout

In `docs/configuration.md` (or the S3-layout section of README if that's
where the vault layout table lives — check both, edit the one that documents
`_system/`), describe: events land as `_system/log/<ts>-<rand>.md` and
`_system/usage/<ts>-<rand>.json`; the legacy single-file logs remain readable
history; concatenate with
`aws s3 cp --recursive` + `cat` (one example line) when a single file is wanted.

**Verify**: `grep -n "_system/log/" docs/ README.md -r` → documented once.

### Step 5: Full regression

**Verify**: `pnpm build && pnpm test:e2e` → all pass. If any e2e spec asserts
on `log.md` content after an operation (grep the specs for `log`), that
assertion moves to the new layout — such a spec edit is in scope; note it in
the commit.

## Test plan

As Step 3; e2e sweep as the integration gate.

## Done criteria

- [ ] `pnpm typecheck`, unit, e2e all exit 0
- [ ] `grep -n "getObject" web/lib/log-append.ts web/lib/usage-log.ts` → no read-before-write remains
- [ ] Concurrent-append unit test exists and passes
- [ ] Log layout documented
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Anything in the app READS `log.md` or `usage-log.jsonl` programmatically
  (grep first — if a reader exists, the derived-view story changes; report).
- The portal UI surfaces `_system/log.md` to users somewhere (e.g. a hardcoded
  link) — report where.
- PRD §12's `LOG.md` contract requires a single human-readable file in the
  vault root — check `prd_canopy_markdown_llm_wiki.md` §12 before Step 1;
  if it mandates one file, STOP and propose the derived-view compactor
  variant instead of proceeding.

## Maintenance notes

- Follow-up (deliberately out of scope): a compactor that periodically folds
  event objects into a monthly `log-YYYY-MM.md` (filename shape already
  excluded from indexing) for human browsing.
- Reviewer: confirm the `_system/` exclusion really covers the new prefixes in
  tree/search/index paths (the unit test asserts `isDocumentKey` is false for
  samples).
