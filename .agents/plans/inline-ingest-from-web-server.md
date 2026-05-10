# Feature: Inline Curation from Web Server

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Move the curation pipeline logic (Bedrock plan call, fan-out page generation, S3 writes, index regeneration) into the Next.js web server so it can run when a user triggers "Curate" from the portal. Upload and curation are separate, decoupled actions — upload puts a file in `<space>/raw/`, curation processes it into wiki pages.

## User Story

As a Vaultmark user deploying on Vercel
I want to upload a file and then trigger curation when I'm ready
So that raw documents are transformed into structured wiki pages without needing CLI access

## Problem Statement

The portal is deployed on Vercel (serverless). The curation logic (Bedrock calls, page generation) lives only in a separate `ingest/` CLI package that can only run locally. When a user uploads a file via the portal, it lands in `<space>/raw/` but there's no way to process it from the portal.

## Solution Statement

Add the curation core logic as library modules inside `web/lib/ingest/`. A new `POST /api/curate` route handler calls these modules to run the full pipeline. Upload (`POST /api/upload`) remains a simple S3 write — no processing. The user explicitly triggers curation when ready.

**Flow:**
```
Upload (drag-drop or manual) → <space>/raw/file.md → user clicks "Curate" → POST /api/curate → Bedrock → pages appear
```

**Deferred:** Auto-curation (triggered automatically when file drops in raw/) — future phase.

## Feature Metadata

**Feature Type**: Refactor
**Estimated Complexity**: Medium
**Primary Systems Affected**: `web/lib/`, `web/app/api/upload/`, `web/app/api/ingest/`
**Dependencies**: `@aws-sdk/client-bedrock-runtime` (new dep for web package)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `web/lib/s3.ts` (full file) - Why: The web's S3 client. Ingest modules must use THIS client, not the ingest/ package's client. Exports: `listObjects`, `getObject`, `putObject`, `deleteObject`, `getObjectWithETag`, `ConcurrencyError`.
- `web/lib/index-gen.ts` (full file) - Why: Existing index regeneration. Must be replaced/extended with space-aware version. Currently generates a flat index.md.
- `web/lib/log-append.ts` (full file) - Why: Existing log append. Must be extended to support ingest events (currently only supports 'created'|'edited'|'deleted').
- `web/app/api/upload/route.ts` (full file) - Why: Current upload route. Must be modified to trigger ingest inline.
- `web/app/api/ingest/route.ts` (full file) - Why: Current ingest trigger route. Must be modified to actually run the pipeline instead of just listing pending files.
- `web/app/api/docs/route.ts` (full file) - Why: Pattern reference for how Route Handlers call lib modules, handle errors, and return responses.
- `ingest/src/bedrock.ts` (full file) - Why: Source of truth for Bedrock converse API wrapper. Must be ported to web/lib/ingest/.
- `ingest/src/plan.ts` (full file) - Why: Plan call logic. Must be ported.
- `ingest/src/generate.ts` (full file) - Why: Fan-out generation logic. Must be ported.
- `web/package.json` - Why: Need to add `@aws-sdk/client-bedrock-runtime` dependency.

### New Files to Create

- `web/lib/ingest/bedrock.ts` - Bedrock converse API wrapper (ported from ingest/src/bedrock.ts)
- `web/lib/ingest/plan.ts` - Plan call (ported from ingest/src/plan.ts)
- `web/lib/ingest/generate.ts` - Fan-out page generation (ported from ingest/src/generate.ts)
- `web/lib/ingest/run.ts` - Orchestrator: ties plan → generate → write → index together
- `web/app/api/curate/route.ts` - NEW route: triggers curation pipeline

### Files to Modify

- `web/app/api/upload/route.ts` - Simplify: just upload to S3, no ingest trigger
- `web/lib/index-gen.ts` - Make space-aware (regenerateSpaceIndex + regenerateMasterIndex)
- `web/lib/log-append.ts` - Support 'curated' action type
- `web/lib/s3.ts` - Add `listSpaces()` function (ListObjectsV2 with Delimiter)
- `web/package.json` - Add `@aws-sdk/client-bedrock-runtime`

### Files to Delete

- `web/app/api/ingest/route.ts` - Replaced by `web/app/api/curate/route.ts`

### Patterns to Follow

**Route Handler pattern** (from `web/app/api/docs/route.ts`):
```typescript
import { NextResponse } from 'next/server';
import { someLib } from '@/lib/some-lib';

export async function POST(req: Request) {
  const body = await req.json();
  // validate
  if (!field) return NextResponse.json({ detail: 'error' }, { status: 400 });
  // do work
  try {
    await someLib(args);
  } catch (err) {
    // handle specific errors
    throw err;
  }
  return NextResponse.json({ result }, { status: 201 });
}
```

**Lib module pattern** (from `web/lib/s3.ts`):
- Singleton client with lazy init
- Env vars read at module level (or lazily)
- Named exports, no default exports
- Async functions returning typed results

**Error handling**: throw errors from lib, catch in route handler, return appropriate HTTP status.

**Imports**: Use `@/lib/` path alias for all internal imports.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Add Bedrock SDK dependency and S3 `listSpaces()` function.

**Tasks:**
- Add `@aws-sdk/client-bedrock-runtime` to web/package.json
- Add `listSpaces()` to web/lib/s3.ts
- Update web/lib/index-gen.ts to be space-aware

### Phase 2: Core Implementation

Port the ingest logic into web/lib/ingest/.

**Tasks:**
- Create web/lib/ingest/bedrock.ts (Bedrock wrapper)
- Create web/lib/ingest/plan.ts (plan call)
- Create web/lib/ingest/generate.ts (fan-out generation)
- Create web/lib/ingest/run.ts (orchestrator)

### Phase 3: Integration

Wire the ingest logic into the API routes.

**Tasks:**
- Rewrite POST /api/ingest to run the pipeline
- Update POST /api/upload to trigger ingest when AUTO_INGEST=true
- Update log-append to support ingest events

### Phase 4: Testing & Validation

**Tasks:**
- Typecheck passes
- Build passes
- Manual test via curl to /api/upload and /api/ingest

---

## STEP-BY-STEP TASKS

### Task 1: ADD `@aws-sdk/client-bedrock-runtime` to web/package.json

- **IMPLEMENT**: Add `"@aws-sdk/client-bedrock-runtime": "^3.1041.0"` to dependencies
- **VALIDATE**: `pnpm install` succeeds

### Task 2: UPDATE `web/lib/s3.ts` — add `listSpaces()`

- **IMPLEMENT**: Add a `listSpaces()` function that uses `ListObjectsV2Command` with `Delimiter: '/'` to discover top-level folders. Return string[] of space names (strip trailing `/`).
- **PATTERN**: Same singleton client pattern as existing functions in this file.
- **IMPORTS**: Add nothing new — `ListObjectsV2Command` is already imported.
- **GOTCHA**: The existing `listObjects` only returns `.md` files. `listSpaces` uses `CommonPrefixes` from the delimiter response, not `Contents`.
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 3: UPDATE `web/lib/index-gen.ts` — make space-aware

- **IMPLEMENT**: Replace `regenerateIndex()` with two functions:
  - `regenerateSpaceIndex(space: string)` — lists `<space>/` excluding `<space>/raw/` and `<space>/index.md`, writes `<space>/index.md`
  - `regenerateMasterIndex()` — discovers all spaces via `listSpaces()`, aggregates into root `index.md`, excludes `personal/`
- **IMPORTS**: Add `listSpaces` from `@/lib/s3`
- **GOTCHA**: The existing `regenerateIndex()` is called by `web/app/api/docs/[...id]/route.ts` (DELETE handler) and `web/app/api/docs/route.ts` (POST handler). Update those call sites to use the new function names. Since existing content is under `wiki/`, call `regenerateSpaceIndex('wiki')` + `regenerateMasterIndex()` at those sites.
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 4: UPDATE `web/lib/log-append.ts` — support ingest action

- **IMPLEMENT**: Change the `action` parameter type from `'created' | 'edited' | 'deleted'` to `'created' | 'edited' | 'deleted' | 'ingested'`
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 5: CREATE `web/lib/ingest/bedrock.ts`

- **IMPLEMENT**: Port from `ingest/src/bedrock.ts`. Key changes:
  - Remove `process.exit(1)` calls — throw errors instead (route handler catches them)
  - Use `process.env.VAULT_REGION` for region (same as S3 client)
  - Use `process.env.INGEST_MODEL ?? 'amazon.nova-2-lite-v1:0'` for model ID
  - Keep the same `converseWithTool<T>()` signature and `ToolSchema` type
  - Export: `converseWithTool`, `ToolSchema` type
- **IMPORTS**: `@aws-sdk/client-bedrock-runtime` (BedrockRuntimeClient, ConverseCommand, types)
- **GOTCHA**: In the error handling, throw descriptive Error objects instead of process.exit. The route handler will catch and return 500.
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 6: CREATE `web/lib/ingest/plan.ts`

- **IMPLEMENT**: Port from `ingest/src/plan.ts`. Key changes:
  - Import `converseWithTool` from `@/lib/ingest/bedrock` (not relative `./bedrock.js`)
  - Same function signature: `planPages(rawContent, indexContent, rawKey, space)`
  - Same types: `PagePlanEntry`, `IngestPlan`
  - Same system prompt and tool schema
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 7: CREATE `web/lib/ingest/generate.ts`

- **IMPLEMENT**: Port from `ingest/src/generate.ts`. Key changes:
  - Import `converseWithTool` from `@/lib/ingest/bedrock`
  - Import `getObject` from `@/lib/s3` (not `./s3.js`)
  - Import types from `@/lib/ingest/plan`
  - Same function signature: `generatePages(plan, rawContent, rawKey, space)`
  - Same `GeneratedPage` type export
  - Same concurrency limit (3), same parallel helper
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 8: CREATE `web/lib/ingest/run.ts`

- **IMPLEMENT**: Orchestrator function that ties the pipeline together:
  ```typescript
  export async function runIngest(space: string, rawKey: string): Promise<IngestResult>
  ```
  Steps:
  1. Read raw doc from S3 via `getObject(rawKey)`
  2. Read space index via `getObject(`${space}/index.md`)` (catch if missing)
  3. Call `planPages(content, indexContent, rawKey, space)`
  4. Call `generatePages(plan, content, rawKey, space)`
  5. Write each generated page via `putObject(page.key, page.content)`
  6. Call `regenerateSpaceIndex(space)`
  7. Call `regenerateMasterIndex()`
  8. Call `appendLog('ingested', rawKey, ...)`
  9. Return result: `{ pages: GeneratedPage[], plan: IngestPlan }`
- **IMPORTS**: `getObject`, `putObject` from `@/lib/s3`; `planPages` from `@/lib/ingest/plan`; `generatePages` from `@/lib/ingest/generate`; `regenerateSpaceIndex`, `regenerateMasterIndex` from `@/lib/index-gen`; `appendLog` from `@/lib/log-append`
- **EXPORT**: `runIngest`, `IngestResult` type
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 9: CREATE `web/app/api/curate/route.ts` — run the curation pipeline

- **IMPLEMENT**: New route that runs the full Bedrock curation pipeline:
  ```typescript
  POST /api/curate { space: string, key?: string }
  ```
  - If `key` provided: run `runIngest(space, key)`, return generated pages
  - If no `key`: list all files in `<space>/raw/`, run `runIngest` for each, return aggregate results
  - Return: `{ space, processed: string[], pages: { key, title }[] }`
- **IMPORTS**: `runIngest` from `@/lib/ingest/run`; `listObjects` from `@/lib/s3`
- **GOTCHA**: Vercel serverless functions have a timeout (default 10s, can be extended to 60s on Pro). For MVP single-user this is fine. Add a note about timeout.
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 10: UPDATE `web/app/api/upload/route.ts` — simplify to upload-only

- **IMPLEMENT**: Remove the `AUTO_INGEST` check. The upload route just writes to S3 and returns:
  ```typescript
  return NextResponse.json({ key, space });
  ```
  No ingest trigger. Curation is a separate user action via `POST /api/curate`.
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 10b: DELETE `web/app/api/ingest/route.ts`

- **IMPLEMENT**: Remove this file. Replaced by `web/app/api/curate/route.ts`.
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 11: UPDATE call sites of old `regenerateIndex()`

- **IMPLEMENT**: In `web/app/api/docs/[...id]/route.ts` and `web/app/api/docs/route.ts`, replace `import { regenerateIndex } from '@/lib/index-gen'` with the new space-aware functions. For the existing wiki/ content, call `regenerateSpaceIndex('wiki')` then `regenerateMasterIndex()`.
- **VALIDATE**: `pnpm --filter @vaultmark/web typecheck`

### Task 12: VALIDATE full build

- **VALIDATE**: `pnpm --filter @vaultmark/web build`

---

## TESTING STRATEGY

### Unit Tests

Not applicable for MVP — the project uses build + typecheck as the minimum gate.

### Integration Tests

Manual curl tests against the running dev server or Vercel deployment.

### Edge Cases

- Upload a non-.md file → 400 error
- Ingest with no space → 400 error
- Ingest on empty raw/ → 404
- Bedrock throttling → 500 with descriptive error
- Bedrock access denied → 500 with descriptive error
- Very large document (>100KB) → should still work within Vercel timeout

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @vaultmark/web typecheck
```

### Level 2: Build

```bash
pnpm --filter @vaultmark/web build
```

### Level 3: Manual Validation

```bash
# Start dev server
pnpm --filter @vaultmark/web dev

# Test upload
curl -X POST http://localhost:3000/api/upload \
  -F "file=@/tmp/test.md" \
  -F "space=articles"

# Test ingest trigger
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"space": "articles", "key": "articles/raw/test.md"}'
```

---

## ACCEPTANCE CRITERIA

- [ ] `@aws-sdk/client-bedrock-runtime` added to web package
- [ ] `web/lib/s3.ts` exports `listSpaces()`
- [ ] `web/lib/index-gen.ts` exports `regenerateSpaceIndex()` and `regenerateMasterIndex()`
- [ ] `web/lib/ingest/bedrock.ts` exists and exports `converseWithTool`
- [ ] `web/lib/ingest/plan.ts` exists and exports `planPages`
- [ ] `web/lib/ingest/generate.ts` exists and exports `generatePages`
- [ ] `web/lib/ingest/run.ts` exists and exports `runIngest`
- [ ] `POST /api/ingest` actually runs the Bedrock pipeline and returns generated pages
- [ ] `POST /api/upload` with `AUTO_INGEST=true` triggers ingest inline
- [ ] `pnpm --filter @vaultmark/web typecheck` passes
- [ ] `pnpm --filter @vaultmark/web build` passes
- [ ] No regressions in existing doc CRUD routes

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] No linting or type checking errors
- [ ] Manual testing confirms upload + ingest works end-to-end
- [ ] Acceptance criteria all met

---

## NOTES

**Terminology**: "Curation" = the process of transforming a raw file into structured wiki pages via Bedrock. Upload and curation are decoupled — upload puts the file in raw/, curation processes it. Auto-curation (triggered on upload) is deferred to a future phase.

**Vercel timeout**: Serverless functions default to 10s timeout (60s on Pro plan). A single-file curation with 3-4 Bedrock calls may take 15-30s. For MVP single-user this is acceptable on Pro. If on free tier, may need to reduce concurrency or accept timeouts on large docs.

**Duplicate vs shared code**: The curation logic is duplicated between `ingest/` (CLI) and `web/lib/ingest/` (server). This is intentional — the CLI uses its own S3 client with lazy env var checking and `process.exit()` error handling, while the web server uses the existing `@/lib/s3` client and throws errors. Keeping them separate avoids import path complexity across workspace packages.

**Future**: Auto-curation (event-driven when file drops in raw/) is a future phase. The `web/lib/ingest/` modules stay the same — only the trigger mechanism changes.

**ENV var for Vercel**: Add `INGEST_MODEL=amazon.nova-2-lite-v1:0` to Vercel env vars (or rely on the default).
