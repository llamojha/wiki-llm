# Plan 002: Enforce the document-key allowlist on doc GET and star PATCH

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- 'web/app/api/docs/[...id]/route.ts' 'web/app/api/star/[...id]/route.ts' tests/e2e/read-paths.spec.ts tests/e2e/star.spec.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

Two routes accept an arbitrary S3 key from the URL and act on it without the
document-key allowlist that their sibling write paths enforce:

1. `GET /api/docs/<...key>` (always reachable — read paths are deliberately
   never feature-gated) fetches **any** object under the vault prefix: the
   full chat-question history in `_system/usage-log.jsonl`, curate job state
   in `_system/jobs/*.json`, `_system/processed.json`, and other users'
   private content under `users/<other>/authored/personal/`.
2. `PATCH /api/star/<...key>` (gated behind `FEATURE_STAR`, default off)
   reads any existing object, round-trips it through gray-matter, injects
   `starred:` frontmatter, and writes it back — it can rewrite `_system/`
   files or any other non-document object.

Today the deployment is single-user, but the portal is the isolation boundary
for the planned multi-tenant phase (ROADMAP Phase 6), and the repo is about to
go public. The fix is symmetric with guards that already exist in the same
files, so this is a small, low-risk change.

## Current state

- `web/app/api/docs/[...id]/route.ts` — doc read/write/delete route.
  - `GET` (lines 24-39) has **no key validation**:

    ```ts
    export async function GET(_req: Request, { params }: Params) {
      const { id } = await params;
      const key = decodeURIComponent(id.join('/'));

      let raw: string;
      let etag: string;
      try {
        const result = await getObjectWithETag(key);
    ```

  - `PUT` in the same file (lines 65-81) shows the guard to mirror, with a
    comment explaining exactly why it matters:

    ```ts
    // The editor may only write real documents. Without this, an arbitrary key
    // (e.g. `_themes/evil.css`) could be PUT with arbitrary content — which the
    // theme loader would then inline as a theme, defeating the "operator-only"
    // guarantee of THEME_VAULT_PREFIX. See docs/theming.md.
    if (!isDocumentKey(key)) {
      return NextResponse.json(
        { detail: `Not an editable document key: ${key}` },
        { status: 400 },
      );
    }
    ```

- `web/app/api/star/[...id]/route.ts` — the whole route is 48 lines; `PATCH`
  (lines 9-47) goes `flagGuard('star')` → `key = decodeURIComponent(id.join('/'))`
  → `getObjectWithETag(key)` → flip `fm.starred` → `putObject(key, updated, etag)`.
  No `isDocumentKey` anywhere; `isDocumentKey` is not imported.
- `web/lib/vault-paths.ts:79-93` — `isDocumentKey(key)`: `.md`-only, excludes
  `raw/`, `_system/`, `users/<id>/raw/`, `users/<id>/_system/`, `index.md`,
  `log.md`, `log-*.md`, `.keep`; allows only the four content roots
  (`generated/`, `authored/`, `users/<id>/generated/`, `users/<id>/authored/`).
- Convention: error responses are `{ detail: string }`; a missing/forbidden
  document read returns 404 (a disabled feature also 404s — see
  `web/lib/flags.ts:102-108` — so "looks like it doesn't exist" is the house
  style for denied access).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0              |
| Typecheck | `pnpm typecheck`         | exit 0, no errors   |
| E2E       | `pnpm build && pnpm test:e2e` (repo root) | all pass |

## Scope

**In scope** (the only files you should modify):
- `web/app/api/docs/[...id]/route.ts` (GET handler only)
- `web/app/api/star/[...id]/route.ts`
- `tests/e2e/read-paths.spec.ts` (extend)
- `tests/e2e/star.spec.ts` (extend)

**Out of scope** (do NOT touch, even though they look related):
- `web/app/api/raw/route.ts` — separate surface; audit it separately if asked.
- `web/lib/vault-paths.ts` — `isDocumentKey` is correct as-is; do not widen it.
- The `PUT`/`DELETE` handlers in `docs/[...id]/route.ts` — already guarded.
- Agent tool scope checks (`web/lib/agent-tools.ts`) — separate layer, already enforced.

## Git workflow

- Branch: `advisor/002-doc-key-allowlist`
- Commit style: imperative, under 72 chars. One logical change per commit.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Guard `GET` in `docs/[...id]/route.ts`

After computing `key` (line 26), add:

```ts
if (!isDocumentKey(key)) {
  return NextResponse.json(
    { detail: `Document not found: ${key}` },
    { status: 404 },
  );
}
```

Use 404 with the same body shape as the existing not-found response (lines
35-38) so a probe cannot distinguish "exists but forbidden" from "missing".
`isDocumentKey` is already imported in this file for `PUT` — confirm, and
reuse the import.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Guard `PATCH` in `star/[...id]/route.ts`

Import `isDocumentKey` from `@/lib/vault-paths`. After computing `key`
(line 14), add the same 404-on-non-document check as Step 1 (star is also a
"document" operation; use 404 + `Document not found` for symmetry with the
route's own existing 404 at lines 23-26).

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Extend e2e specs

- In `tests/e2e/read-paths.spec.ts`: seed a `_system/usage-log.jsonl`-like
  object via the suite's seeding mechanism (read `tests/e2e/fixtures.ts` and
  `helpers.ts` first; the seed route is `web/app/api/test-seed/route.ts`),
  then assert `GET /api/docs/_system%2Fusage-log.jsonl` (and the un-encoded
  multi-segment form `/api/docs/_system/usage-log.jsonl`) returns 404. Also
  assert a normal seeded document still returns 200 with `raw_markdown`.
- In `tests/e2e/star.spec.ts`: assert `PATCH /api/star/_system/index.md`
  returns 404 and the object body is unchanged afterward; assert starring a
  real seeded document still toggles and returns `{ starred: true }`.

**Verify**: `pnpm build && pnpm test:e2e -- --grep "read-paths|star"` → all
pass, including the new cases.

## Test plan

- New e2e cases (Step 3): system-key read rejected (404), other-scope personal
  key read rejected (`users/someone-else/authored/personal/x.md` → 404),
  system-key star rejected, happy paths unchanged. Model after existing tests
  in the same spec files.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm build && pnpm test:e2e` exits 0, including new cases
- [ ] `grep -n "isDocumentKey" web/app/api/docs/[...id]/route.ts` shows a use inside `GET`
- [ ] `grep -n "isDocumentKey" web/app/api/star/[...id]/route.ts` shows an import and a use
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above don't match the live code (drift).
- Any existing e2e spec fails because the UI legitimately reads a
  non-document key through `GET /api/docs/...` (would mean the browse UI
  depends on the unguarded behavior — report which key).
- You find yourself wanting to modify `isDocumentKey` to make a test pass.

## Maintenance notes

- Phase 6 (multi-tenant) must add *ownership* checks on top of this key-shape
  check — `isDocumentKey` says "is a document", not "is YOUR document". See
  also Plan 009 (userId validation) which hardens the other half.
- Reviewer should scrutinize: the 404-vs-400 choice on star (this plan picks
  404 for probe-resistance; the editor PUT uses 400 — asymmetry is accepted
  and documented here).
