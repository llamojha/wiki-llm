# Plan 016: Decompose the 1167-line UploadModal into four tab components

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/components/upload-modal.tsx web/components/library`
> If `upload-modal.tsx` changed since `fead8f9`, STOP — this plan's line map
> is stale and must be re-derived.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED (stateful client component; reset-on-open and stale-closure
  behaviors are easy to break)
- **Depends on**: plans/003 (e2e in CI — the safety net), plans/012+013 (avoid
  conflicts — they don't touch this file, but land the cheap wins first)
- **Category**: tech-debt
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

`web/components/upload-modal.tsx` is the Library modal: 1167 lines, one
function component holding four independent features — file upload, curation
("Pending") job streaming, re-index streaming, and a recursive folder-tree
CRUD editor — behind a tab switch. It declares ~40 `useState`/`useRef` hooks
and 7+ `useEffect`s across unrelated concerns, and is the highest-churn file
in the repo (6 of the last 30 commits). Every feature change edits one shared
state blob; the component already hand-rolls `scopeRef`/`spaceRef`/
`destinationRef`/`folderRef` mirrors to dodge stale closures in async upload
chains. Testing one tab requires mounting all four. Decomposition is pure
structure: no behavior change, e2e suite as the referee.

## Current state

Line map of `web/components/upload-modal.tsx` at `fead8f9`:

- 1-34: imports, `UploadModalProps`, `LibraryTab`/`Destination` types
- 35-105: module-level pure helpers — `findFolder`, `descendantPaths`,
  `childExists`, `countFolders`, `validPath` (folder-tree walking), `fmtSize`,
  `defaultSpace`
- 107-188: shell state — `tab`, `scope`, `folderTree` + `folderNonce`,
  `space`, `destination`, `folder`, `cliOpen`, upload `files`/`dragActive`;
  the four `*Ref` mirrors (136-143); reset-on-open effect (~235-250); folder
  tree fetch effect keyed on `folderNonce`/`scope` (~163)
- 190-208: Pending tab state (`pending*` ×9, `abortRef`, `jobIdRef`) + effect
- 210-216: Re-index tab state (`reindex*` ×6)
- 218-233: Folders tab state (`newFolder`, `expanded`, `editingPath`,
  `editValue`, `deletingPath`, `addingChildPath`, `childValue`, `folderBusy`,
  two input refs)
- ~253-350: upload logic — `processFile`/`addFiles` per-file async chaining
  (uses the Ref mirrors), drag handlers
- ~353-477: Pending logic — `startPendingStream` (NDJSON reader),
  `cancelPending`, polling
- ~481-512: Re-index logic — `startReindex` (NDJSON reader; posts `{ space }`
  in folder mode)
- ~514-692: Folders logic — create/rename/delete/add-child handlers +
  recursive `renderNode`
- ~694-1167: JSX for all four tabs, switched on `tab`
- Consumers: `web/components/app-shell.tsx` renders `<UploadModal …/>` with
  `UploadModalProps = { open, initialTab, spaces, onClose, onUploaded,
  showToast, flags, s3Location }` (line 107). `initialTab` deep-links tabs.
- Conventions: kebab-case files; `'use client'` components under
  `web/components/`; props interfaces named `{Component}Props`; no barrel
  exports unless 3+ exports; plain CSS classes from `web/app/globals.css` —
  JSX class names must not change (CSS targets them).
- E2E coverage that referees the refactor: `tests/e2e/upload.spec.ts`,
  `curate.spec.ts`, `reindex.spec.ts`, `folders.spec.ts`, `flags-off.spec.ts`
  (tab visibility under flags).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| E2E       | `pnpm build && pnpm test:e2e` | all pass |
| Line size | `wc -l web/components/library/*.tsx` | no file > ~400 |

## Scope

**In scope**:
- `web/components/upload-modal.tsx` (becomes the thin shell; keep the file
  name and the `UploadModal` export — app-shell must not change)
- `web/components/library/` (create): `upload-tab.tsx`, `pending-tab.tsx`,
  `reindex-tab.tsx`, `folders-tab.tsx`, `use-library-state.ts` (shared hook)
- `web/lib/folder-tree.ts` (create — the pure helpers from lines 35-95)

**Out of scope**:
- `web/components/app-shell.tsx` — the public props contract is frozen.
- Any API route, any `web/lib` module except the new `folder-tree.ts`.
- CSS files / class names.
- Behavior changes of ANY kind — including "obvious" UX fixes you notice.
- Server-side folder logic (`web/lib/folders.ts`) — plan 015's territory;
  the client helpers move to `web/lib/folder-tree.ts` but do NOT merge with
  server code (different node types: client `FolderNode` from the API
  response vs server build types).

## Git workflow

- Branch: `advisor/016-split-upload-modal`
- Commit per step (helpers out → shared hook → one tab at a time) so each
  commit typechecks and passes e2e — the review diff must never contain a
  broken intermediate.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the pure helpers

Move lines 35-95 (`findFolder`, `descendantPaths`, `childExists`,
`countFolders`, `validPath`) into `web/lib/folder-tree.ts` with their types;
`fmtSize`/`defaultSpace` stay in the component (UI-local). Import back into
`upload-modal.tsx`. Zero logic edits.

**Verify**: `pnpm typecheck`; `pnpm build && pnpm test:e2e -- --grep folders` → pass.

### Step 2: Shared library state hook

Create `web/components/library/use-library-state.ts` exporting
`useLibraryState({ open, initialTab, spaces, flags })` that owns ONLY the
genuinely shared state: `tab`, `scope`, `space`, `destination`, `folder`,
`folderTree` + `folderNonce` + refetch effect, the reset-on-open effect, and
the four Ref mirrors (they exist because upload's async chain reads
post-render values — keep them and their comment). Return values + setters as
one object.

**Verify**: `pnpm typecheck`; full e2e → pass (behavior identical — the hook
is the same code relocated).

### Step 3: Extract tabs one at a time (four commits)

Order: `reindex-tab` (smallest) → `pending-tab` → `folders-tab` →
`upload-tab`. Each `<XxxTab>` receives the shared-state object plus the
shell-owned callbacks (`showToast`, `onUploaded`, `s3Location`, `flags`) as
props (`{Tab}Props` interface each), and owns its private state/effects/JSX
(the line ranges in Current state). `upload-modal.tsx` shrinks to: shell
state via the hook, tab bar JSX, `{tab === 'upload' && <UploadTab …/>}` etc.
Keep every JSX class name and data-testid byte-identical (the e2e selectors
depend on them — grep the specs for selectors before moving JSX).

**Verify after EACH tab**: `pnpm typecheck` && full `pnpm test:e2e` → green
before the next extraction.

### Step 4: Size and hygiene check

`wc -l` on the new files (shell + 4 tabs + hook): target no file >400 lines;
`grep -n "useState" web/components/upload-modal.tsx` → only shell/tab-switch
state remains.

**Verify**: `pnpm build && pnpm test:e2e` full suite → green.

## Test plan

No new tests: the existing upload/curate/reindex/folders/flags-off e2e specs
are the characterization suite; the per-step full-suite runs are the gate.
(If plan 004 landed, `web/lib/__tests__/folder-tree.test.ts` for the moved
pure helpers is a welcome small addition.)

## Done criteria

- [ ] `pnpm typecheck` exits 0; full e2e suite green
- [ ] `wc -l web/components/upload-modal.tsx` ≤ ~200 (thin shell)
- [ ] Four tab components + hook exist under `web/components/library/`
- [ ] `git diff fead8f9 -- web/components/app-shell.tsx` → empty
- [ ] No CSS class name changed (`git diff` contains no `className` string edits, only relocations)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `upload-modal.tsx` drifted from the line map (drift check).
- An e2e spec fails after an extraction and the cause isn't an import/prop
  slip you can fix in one attempt — revert THAT extraction commit and report
  which tab and which spec.
- You are tempted to fix a behavior bug you found — record it in the report;
  do not fix it here.
- The shared hook needs more than the listed state to keep tabs working
  (indicates hidden coupling — report what).

## Maintenance notes

- Future tab additions get their own file; the shell should stay dumb.
- The Ref-mirror pattern in the hook is load-bearing for the upload chain —
  a reviewer seeing "why not just use state?" should read the original
  comment (kept) before simplifying.
- Follow-up candidate: replace the NDJSON stream readers duplicated between
  pending-tab and reindex-tab with one `useNdjsonStream` hook (deferred —
  behavior-preserving refactor first).
