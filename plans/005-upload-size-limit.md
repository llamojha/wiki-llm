# Plan 005: Enforce an upload size limit

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/app/api/upload/route.ts tests/e2e/upload.spec.ts docs/configuration.md infra/.env.example`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

`POST /api/upload` reads the whole multipart file into memory
(`await file.text()`) with no byte cap. Next.js 16 App Router route handlers
impose no legacy body-size limit, so an oversized upload exhausts server
memory on the shared Next.js process — a denial-of-service vector. The only
current validation is the `.md` extension and filename/space/folder shape.
Gated behind `FEATURE_UPLOAD` (default off), which limits exposure but is not
control for deployments that enable upload.

## Current state

- `web/app/api/upload/route.ts` — after the destination/space/folder
  validation block, the file is read unconditionally:

  ```ts
  if (!file.name.endsWith('.md')) {
    return NextResponse.json({ detail: 'only .md files are accepted' }, { status: 400 });
  }

  const scope = resolveScope({ scope: scopeName, userId });
  const filename = sanitizeFilename(file.name);
  const folderPrefix = folder ? `${folder}/` : '';
  const key = destination === 'raw'
    ? `${scope.rawPrefix}${folderPrefix}${filename}`
    : `${scope.authoredPrefix(space as string)}${folderPrefix}${filename}`;
  const content = await file.text();
  ```

- `file` is a Web `File` (from `req.formData()`), which exposes `file.size`
  (bytes) before any read.
- Error convention: `{ detail: string }` JSON with an appropriate status
  (400 validation, 409 conflict). Use **413** for over-size.
- Config conventions: env vars documented in `docs/configuration.md` tables
  and listed in `infra/.env.example`; flags/env are read once at module load
  (see `web/lib/flags.ts` pattern).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| E2E       | `pnpm build && pnpm test:e2e -- --grep upload` | all pass |

## Scope

**In scope**:
- `web/app/api/upload/route.ts`
- `tests/e2e/upload.spec.ts` (extend)
- `docs/configuration.md`, `infra/.env.example` (document the new var)

**Out of scope**:
- `web/components/upload-modal.tsx` — a client-side friendly pre-check is a
  nice-to-have follow-up, NOT this plan (the server check is the control).
- Content sniffing / MIME validation — deferred; extension check stays as-is.
- Any other route reading request bodies.

## Git workflow

- Branch: `advisor/005-upload-size-limit`
- Commit style: imperative, under 72 chars.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the limit

In `web/app/api/upload/route.ts`, at module level:

```ts
/** Max accepted upload size in bytes. Override with UPLOAD_MAX_BYTES. */
const UPLOAD_MAX_BYTES = (() => {
  const raw = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 2 * 1024 * 1024; // 2 MiB default
})();
```

In the handler, immediately after the `.md`-extension check and BEFORE
`await file.text()`:

```ts
if (file.size > UPLOAD_MAX_BYTES) {
  return NextResponse.json(
    { detail: `file exceeds the ${UPLOAD_MAX_BYTES}-byte upload limit` },
    { status: 413 },
  );
}
```

(2 MiB is generous for Markdown; the vault's own generated pages are KBs.)

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: e2e case

In `tests/e2e/upload.spec.ts`, add a direct-POST case (the file already
contains direct `/api/upload` POSTs to model after, e.g. its
malformed-folder-rejection test): upload a generated string of
`UPLOAD_MAX_BYTES + 1` bytes (build a `Blob`/multipart in the test) and assert
status 413 with `detail` mentioning the limit; then upload a small file and
assert it still succeeds (200/201 per the route's current success shape —
check the existing assertions in this spec and match them).

Note: the e2e servers in `playwright.config.ts` don't set `UPLOAD_MAX_BYTES`,
so the default 2 MiB applies — the oversize payload must exceed that. If a
>2 MiB in-test payload is unacceptable (slow), set `UPLOAD_MAX_BYTES` for the
webServer env in `playwright.config.ts` — if you do, that file joins the
in-scope list; keep the value comment-documented.

**Verify**: `pnpm build && pnpm test:e2e -- --grep upload` → all pass.

### Step 3: Document

Add `UPLOAD_MAX_BYTES` to the appropriate table in `docs/configuration.md`
(default `2097152`, purpose one-liner) and a commented line in
`infra/.env.example`.

**Verify**: `grep -n UPLOAD_MAX_BYTES docs/configuration.md infra/.env.example web/app/api/upload/route.ts` → one hit each.

## Test plan

- New e2e: oversize rejected with 413 (regression for this plan); small file
  accepted. Model after the direct-POST tests already in `upload.spec.ts`.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm build && pnpm test:e2e` exits 0 incl. the new 413 case
- [ ] `file.size` is checked before `file.text()` in the route (`grep -n "file.size" web/app/api/upload/route.ts`)
- [ ] `UPLOAD_MAX_BYTES` documented in both config docs
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The route no longer matches the excerpt (drift).
- `file.size` is unavailable on the runtime's `File` implementation (would
  need a streaming approach — report, don't improvise one).
- The e2e webServer setup makes the oversize test flaky twice in a row.

## Maintenance notes

- If HTML uploads land later (see plan 022), revisit the default limit and
  the extension check together.
- Reviewer: confirm 413 (not 400) and that the check precedes the read.
