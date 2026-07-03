# Plan 009: Security hardening batch — userId validation, client error hygiene, dependency advisories

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/scope.ts web/app/api/synthesize/route.ts web/app/api/curate/start/route.ts web/app/api/reindex/route.ts web/app/api/chat/route.ts web/package.json pnpm-lock.yaml`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

Three small, independent hardening items, batched because each is under an
hour and none changes behavior for legitimate use:

1. **`userId` shape**: request-supplied `userId` is interpolated into S3 key
   prefixes (`users/${userId}/…`) with no charset validation. A `userId`
   containing `/` writes under a different prefix than the scope later
   inferred on read (`inferScopeFromKey` matches `^users/([^/]+)/`), silently
   breaking the isolation invariant the scope module documents. Latent today
   (single-user), load-bearing for Phase 6 multi-tenant.
2. **Error detail leakage**: several routes return raw AWS SDK `err.message`
   (ARNs, region, internal reasons) to the client and persist it in the usage
   log — low-severity info disclosure that matters more once deployed publicly.
3. **Reachable advisories**: `js-yaml@3.14.2` (via `gray-matter@4.0.3`) has a
   moderate quadratic-complexity DoS advisory (GHSA-h67p-54hq-rp68), reachable
   from uploaded frontmatter on every doc read; and the lockfile resolves
   `@aws-sdk/*` at 3.1067.0, below the manifest floor `^3.1068.0`.

## Current state

- `web/lib/scope.ts:61-86` — `resolveScope(selector)`; user branch:
  `const userId = selector.userId ?? DEFAULT_USER_ID; const userRoot =
  \`${USERS_ROOT}/${userId}\`;` — no validation. Request-supplied `userId`
  reaches it from: `web/app/api/upload/route.ts` (form field),
  `web/app/api/reindex/route.ts:37` (JSON body), `web/app/api/chat/route.ts`
  (~line 54), `web/app/api/curate/start/route.ts` (~line 50),
  `web/app/api/synthesize/route.ts` (~line 47), and `web/app/api/spaces` /
  `folders` routes.
- The repo's existing slug pattern for spaces (reuse it):
  `web/lib/spaces.ts:30` — `export const SPACE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;`
- Error-leak sites (return raw `err.message` to the client):
  - `web/app/api/synthesize/route.ts` (~87-88) and
    `web/app/api/curate/start/route.ts` (~144-145) — JSON `detail`
  - `web/app/api/reindex/route.ts:121` and `web/app/api/chat/route.ts`
    (~100-103) — streamed `{ type:'error', detail }` (chat also persists it via
    `web/lib/usage-log.ts`)
- Dependency facts: `web/package.json` deps `gray-matter@^4.0.3`,
  `@aws-sdk/client-{s3,lambda,bedrock-runtime}@^3.1068.0`. pnpm supports
  root-level overrides via `pnpm.overrides` in the ROOT `package.json`.
- Error convention: `{ detail: string }`; server logs use prefixed
  `console.warn/error` (e.g. `[agent]`, `[usage-log]`, `[s3]`).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| Audit     | `pnpm --dir web audit --prod` | no moderate+ advisory for js-yaml |
| Lockfile  | `pnpm install` then `git diff pnpm-lock.yaml --stat` | updated versions |
| E2E       | `pnpm build && pnpm test:e2e` | all pass |

## Scope

**In scope**:
- `web/lib/scope.ts` (validation)
- `web/lib/__tests__/scope.test.ts` (extend if plan 004 landed; else create is out of scope — note the gap)
- `web/app/api/{synthesize,curate/start,reindex,chat}/route.ts` (error hygiene)
- Root `package.json` (`pnpm.overrides`), `pnpm-lock.yaml` (regenerated)

**Out of scope**:
- Adding auth/tenancy — Phase 6.
- `postcss` advisory via `next` — fixed by Next patch bumps, dependabot's job.
- Upgrading any dependency's major version.
- `web/lib/usage-log.ts` internals (plans/011 restructures logs).

## Git workflow

- Branch: `advisor/009-security-hardening`
- Commit style: imperative, under 72 chars. Three commits (one per item).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Validate `userId` at the scope boundary

In `web/lib/scope.ts`, add at module level (import `SPACE_NAME_RE` is NOT
possible — `spaces.ts` imports would cycle; define locally):

```ts
/** userIds become S3 key segments (`users/<id>/…`). Same slug shape as spaces. */
const USER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export class InvalidUserIdError extends Error {
  constructor(userId: string) {
    super(`invalid userId: ${JSON.stringify(userId)} — must match ${USER_ID_RE}`);
    this.name = 'InvalidUserIdError';
  }
}
```

In `resolveScope`, user branch: after computing `userId`, `if
(!USER_ID_RE.test(userId)) throw new InvalidUserIdError(userId);`.
`DEFAULT_USER_ID` ('default') passes. Then make every route that feeds
request-supplied `userId` into `resolveScope` map `InvalidUserIdError` to a
400 `{ detail: 'invalid userId' }` — routes listed in Current state; find them
all with `grep -rn "resolveScope" web/app`. Routes that stream (reindex, chat)
should validate BEFORE opening the stream (resolveScope is already called
pre-stream in reindex — line 47).

**Verify**: `pnpm typecheck` → exit 0; `pnpm build && pnpm test:e2e` → pass
(the suite uses the default user, so nothing legitimate breaks).

### Step 2: Stop echoing SDK error text

At each leak site, replace the client-facing string with a generic message and
keep the detail server-side:

```ts
console.error('[curate] lambda invoke failed:', err);
return NextResponse.json({ detail: 'curation failed to start' }, { status: 502 });
```

Streamed variants: `send({ type: 'error', detail: 'reindex failed' })` /
chat's error event → generic `'agent run failed'`, with `console.error`
retaining the original. In `chat/route.ts`, whatever string goes to the client
is also what flows into the usage-log `error` field — keep logging the
GENERIC string there (the server log holds the specifics).
Do not change the shape/type of any streamed event.

**Verify**: `pnpm typecheck` → exit 0;
`grep -rn "err.message\|err instanceof Error ? err.message" web/app/api | grep -v docs` —
each remaining hit is a validation/domain message you deliberately kept
(SpaceError-style statuses are fine — they're authored strings, not SDK dumps);
list them in the commit message.

### Step 3: Dependency floor + advisory override

In the ROOT `package.json` add:

```json
"pnpm": { "overrides": { "js-yaml@<4": ">=3.14.2 <4 || ^3.15.0" } }
```

— check first with `pnpm why js-yaml --dir web`: if a `js-yaml@^3.15.x`
publish does not actually exist (verify with `pnpm view js-yaml versions`),
the advisory fix may only ship in 4.x; in that case the correct override is
`"js-yaml": "^4.1.0"` **only if** `gray-matter` works with it — gray-matter
4.x declares js-yaml ^3; a forced 4.x can break frontmatter parsing. Decision
rule: if a patched 3.x exists, pin it; if only 4.x is patched, STOP and report
(swapping the YAML engine is not a batch item — see gray-matter's `engines`
option as the likely follow-up).
Then run `pnpm update --dir web '@aws-sdk/*'` (patch-level) so the lockfile
satisfies `^3.1068.0`.

**Verify**: `pnpm install` exit 0; `pnpm --dir web audit --prod` → js-yaml
advisory resolved (or the STOP taken); `pnpm build && pnpm test:e2e` → pass
(frontmatter round-trips exercised by editor/star/upload specs).

## Test plan

- Unit (if plan 004 landed): `resolveScope` accepts `alice-1`, `default`;
  throws `InvalidUserIdError` for `a/b`, `../x`, `Alice`, empty string.
- E2E: full suite green (frontmatter parsing unchanged after any override).

## Done criteria

- [ ] `pnpm typecheck` exits 0; full e2e suite passes
- [ ] `grep -n "USER_ID_RE" web/lib/scope.ts` → present; invalid userId POSTs return 400 (spot-check one route with a curl against `pnpm dev` or an e2e assertion)
- [ ] No route returns raw SDK `err.message` in a response body (Step 2 grep triaged)
- [ ] `pnpm --dir web audit --prod` shows no js-yaml moderate advisory OR the STOP was reported
- [ ] `plans/README.md` status row updated

## STOP conditions

- js-yaml's fix is 4.x-only (see decision rule in Step 3).
- Any e2e spec legitimately sends a non-slug userId (would mean the UI already
  uses shapes this plan forbids — report which).
- `resolveScope` throwing breaks a call site that treated it as infallible in
  a non-request context (e.g. module init) — report the call site.

## Maintenance notes

- Phase 6 will replace "userId from the request" with "userId from the
  session" — the validation stays as defense-in-depth.
- Reviewer: the generic error strings must not lose operator debuggability —
  confirm each site logs the original error server-side.
