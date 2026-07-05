# Curate pipeline

## What it does

Turns raw uploaded source files into structured wiki pages using Bedrock,
running in a separate Lambda deployment (`infra/lambda/curate/`) rather than
in the Next.js app itself — curation batches can run long enough to need
Lambda's chained-invocation continuation model, which doesn't fit a
request/response route handler.

## The two contracts: provenance vs folders mode

The curate Lambda supports two event contracts, distinguished by
`curateEventVersion` (`infra/lambda/curate/types.ts`):

- **Provenance mode** (`curateEventVersion` 1/2, `mode` absent) — the
  original contract. Raw files live under `raw/`; curated output goes to
  `generated/<space>/`, keyed against `_system/structure.json`'s declared
  spaces. `getGeneratedSpace`/`getGeneratedSpaces`/`loadPlacementHints`
  (`structure.ts`) resolve where each source's output belongs.
- **Folders mode** (`curateEventVersion: 3`, `mode: 'folders'`) — added by
  `plans/026`. The user picks a **source** folder (raw notes) and a
  **destination** folder directly; there's no structure.json space concept.
  `infra/lambda/curate/index.ts`'s handler checks
  `event.mode === 'folders' || event.curateEventVersion === 3` and skips the
  structure-lookup calls entirely (`hints = []`), threading `destination`
  straight into `processSource`. Output pages land at
  `<destination>/<slug>.md` with `origin: generated` frontmatter (see
  [Vault modes](../architecture/vault-modes.md)) instead of a
  `generated/<space>/` path — no hidden subtree, no magic root, by explicit
  maintainer decision.

`web/app/api/curate/start/route.ts`'s `startFolders()` branch builds the
folders-mode event: validates the source/destination pair
(`web/lib/ingest-policy.ts`'s `resolveFoldersIngest` — destination required,
must not be under `_system/`, source ≠ destination), lists pending
`isDocumentKey` files under the source prefix, and invokes the Lambda.
`web/app/api/curate/finalize/route.ts` branches the same way: folders-mode
jobs only need `regenerateMasterIndex` (there's no per-space index to
rebuild) plus a search-index invalidation.

## Job lifecycle

1. `POST /api/curate/start` claims a start lock (`claimStartLock`,
   per-scope — folders mode is single-tenant and uses the shared scope),
   lists pending files, and invokes the Lambda asynchronously
   (`InvocationType.Event`).
2. The Lambda (`handler` in `index.ts`) processes files with bounded
   concurrency (`CURATE_CONCURRENCY`, default 3) and writes progress to a
   per-job JSON file (`job.ts`), serialized through a write queue
   (`createWriteQueue`) so concurrent workers don't clobber each other's
   updates.
3. If the batch won't finish before the Lambda's timeout, the handler
   self-invokes with a `startIndex` continuation (`continueLater`) rather
   than trying to finish everything in one invocation.
4. `GET /api/curate/status` polls job state; `POST /api/curate/finalize`
   regenerates indexes once the job completes; `POST /api/curate/cancel`
   stops it early.

## Optional synthesis pass

After extraction, an opt-in `FEATURE_CURATE_AUTOSYNTH` toggle
(`web/app/api/curate/start/route.ts`) can chain into a synthesis job
(`action: 'SYNTHESIZE'` in the same Lambda, `runSynthesisJob` →
`synthesis.ts`). Synthesis clusters related source cards
(`cluster.ts`'s `clusterSourceCards`) and produces roll-up pages
(`synthesis-prompt.ts`'s `renderRollupPage`) rather than one page per source.
This is a separate runtime toggle from the portal's `FEATURE_*` flags — it
has no UI surface and isn't in `flags.ts`, because it's a server-side
processing choice, not a user-facing feature switch. See
`specs/synthesis-pipeline.md` for the design rationale.

## Manifest concurrency

Curated output is tracked in a per-scope manifest (`manifest.ts`,
`_system/processed.json` equivalent) written with ETag-based optimistic
concurrency (`mergeIntoManifest` / `mergeWithRetry`) so two overlapping curate
jobs can't silently lose each other's writes — a conflict retries the merge
against the freshest manifest rather than overwriting it. `plans/008` is the
design record for this.

## Things to watch when editing

- The curate Lambda is deployed **out of band** from the Next.js app — a
  code change under `infra/lambda/curate/` requires a separate Lambda
  redeploy; it does not ship with `pnpm build`/`pnpm deploy` of `web/`.
  `plans/026`'s own status note and `plans/008`'s precedent both call this
  out explicitly.
- Provenance-mode behavior must stay byte-identical when adding folders-mode
  branches — `renderSourcePage` (`source-card.ts`) only emits an `origin:`
  frontmatter line when explicitly passed one, so provenance-mode output is
  unaffected by the folders-mode addition.
- `CURATE_LAMBDA_ARN` unset disables the feature cleanly
  (`FEATURE_CURATE=off` is the documented way to turn it off if the Lambda
  isn't deployed) rather than the route failing unpredictably.

## Source references

- `infra/lambda/curate/index.ts`, `ingest.ts`, `types.ts`, `manifest.ts`,
  `source-card.ts`, `synthesis.ts`, `cluster.ts`.
- `web/app/api/curate/start/route.ts`, `finalize/route.ts`,
  `status/route.ts`, `cancel/route.ts`.
- `web/lib/ingest-policy.ts` — folders-mode source/destination validation.
- `specs/curation-pipeline.md`, `specs/synthesis-pipeline.md`.
- `plans/008-curate-manifest-concurrency.md`,
  `plans/026-folders-mode-curate-pipeline.md`.
