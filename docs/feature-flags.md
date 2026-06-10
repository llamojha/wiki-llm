# Feature Flags

Every Vaultmark feature is gated by an environment variable. Flags let you run
a locked-down deployment — for example a **read-only published wiki** (all
write features off) or a portal **without any LLM features** (agent + curate
off, no Bedrock permissions needed).

Implementation: [`web/lib/flags.ts`](../web/lib/flags.ts).

## How flags work

- A feature is **ON unless** its env var is set to one of the off-tokens:
  `off`, `false`, `0`, `no`, `disabled` (case-insensitive). An absent var
  means **on** — everything ships enabled with no env changes.
- Flags are read **once at server start** (module load). Changing a flag
  requires a restart (or redeploy); these are not runtime toggles.
- Each flag gates **both layers**:
  1. **UI** — the resolved flags are passed from the root server component
     into the client `AppShell`, which hides the feature's entry points
     (buttons, panels, keyboard shortcuts).
  2. **API** — `flagGuard(name)` short-circuits the matching route handler
     with **HTTP 404** (`{ "detail": "Feature \"<name>\" is disabled" }`).
     The route guard is the actual enforcement; hiding the button is just
     cosmetics. A disabled feature returns 404 rather than 403 so it looks
     like it doesn't exist instead of advertising a locked door.
- **Read paths are never gated.** `GET /api/docs`, `GET /api/docs/{id}`,
  the vault tree, and `GET /api/raw` stay available with every flag off — the
  portal always remains browsable.

## Flag reference

### `FEATURE_AGENT` — Ask-Wiki chat

The Bedrock-powered agent that answers questions grounded in your vault,
cites sources, and proposes new pages (all writes user-confirmed).

- **UI when off:** chat panel, floating chat button, "Ask" buttons on the home
  view and document toolbar, and the `⌘⇧A` shortcut disappear.
- **Routes gated:** `POST /api/chat`.
- **Turn off when:** you don't want Bedrock calls (cost, compliance) or
  haven't granted `bedrock:InvokeModel*`.
- **Depends on:** `BEDROCK_MODEL` / `BEDROCK_REGION` and Bedrock IAM
  permissions when on.

### `FEATURE_UPLOAD` — File upload

Uploading Markdown/source files into the vault's `raw/` area.

- **UI when off:** upload buttons in the sidebar, document toolbar, home view,
  and the upload tab of the library modal disappear.
- **Routes gated:** `POST /api/upload`.
- **Turn off when:** the vault is populated out-of-band (CI, the ingest CLI,
  direct S3 sync) and the portal should be read-only for sources.

### `FEATURE_CURATE` — AI ingest / curation

The pipeline that turns raw uploads into structured wiki pages via Bedrock,
running in the curate Lambda.

- **UI when off:** curation controls in the sidebar and library modal
  disappear.
- **Routes gated:** `POST /api/curate/start`, `GET /api/curate/status`,
  `POST /api/curate/finalize`, `POST /api/curate/cancel`.
- **Turn off when:** you haven't deployed the curate Lambda
  (`CURATE_LAMBDA_ARN` unset) or don't want LLM-generated content.
- **Depends on:** `CURATE_LAMBDA_ARN`, `CURATE_LAMBDA_REGION`,
  `lambda:InvokeFunction` permission when on.

### `FEATURE_REINDEX` — Re-index

Rebuilding the vault's generated `index.md` / search metadata from S3.

- **UI when off:** the re-index button in the sidebar and library modal
  disappears.
- **Routes gated:** `POST /api/reindex`.
- **Turn off when:** indexes are maintained by the ingest pipeline only and
  you don't want portal users triggering S3 writes.

### `FEATURE_EDITOR` — Page CRUD

Creating, editing, and deleting wiki pages from the portal.

- **UI when off:** "New page" (sidebar) and "Edit" buttons (document toolbar,
  generated-doc reader) disappear.
- **Routes gated:** `POST /api/docs`, `PUT /api/docs/{id}`,
  `DELETE /api/docs/{id}`.
- **Turn off when:** publishing a read-only wiki, or content changes must go
  through git/the ingest pipeline instead of the portal.

### `FEATURE_SEARCH` — Search palette

Full-vault fuzzy search (Fuse.js) behind the `⌘K` palette.

- **UI when off:** the search box in the top bar and the `⌘K` shortcut
  disappear.
- **Routes gated:** `GET /api/search`.
- **Turn off when:** the vault is large enough that building the in-memory
  index is undesirable, or search shouldn't be exposed.

### `FEATURE_STAR` — Star / favorite

Marking documents as favorites (persisted to document frontmatter in S3).

- **UI when off:** star buttons on the document toolbar and generated-doc
  reader disappear.
- **Routes gated:** `PATCH /api/star/{id}`.
- **Turn off when:** you want zero S3 writes from readers (stars write
  frontmatter).

### `FEATURE_PUBLISHING` — Personal site / HTML publishing

Planned Phase 8 feature (publishing a vault as a static personal site).

- **UI when off:** nothing yet.
- **Routes gated:** none yet — the flag is reserved so deployments can opt out
  before the feature ships.

## Recipes

**Read-only published wiki** (browse + search only):

```bash
FEATURE_AGENT=off
FEATURE_UPLOAD=off
FEATURE_CURATE=off
FEATURE_REINDEX=off
FEATURE_EDITOR=off
FEATURE_STAR=off
# FEATURE_SEARCH stays on
```

**No-LLM deployment** (no Bedrock IAM permissions needed):

```bash
FEATURE_AGENT=off
FEATURE_CURATE=off
```

**Personal wiki without the Lambda pipeline:**

```bash
FEATURE_CURATE=off
# upload/editor/agent/star all stay on
```

## Adding a new flag

1. Add the feature name and its `FEATURE_*` var to `web/lib/flags.ts`
   (`FeatureName` union + `ENV_BY_FEATURE`).
2. Guard every route handler the feature owns:
   `const blocked = flagGuard('myfeature'); if (blocked) return blocked;`
3. Hide the UI entry points behind `flags.myfeature` in the client components.
4. Document it here and in [`configuration.md`](configuration.md).

Both layers are mandatory — a flag that only hides the button is not feature
control.
