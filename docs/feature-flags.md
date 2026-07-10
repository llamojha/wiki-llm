# Feature Flags

Every Canopy feature is gated by an environment variable. Flags let you run
a locked-down deployment — for example a **read-only published wiki** (all
write features off) or a portal **without any LLM features** (agent + curate
off, no Bedrock permissions needed).

Implementation: [`web/lib/flags.ts`](../web/lib/flags.ts).

## How flags work

- When a flag's env var is **set**, it wins: the feature is ON unless the
  value is one of the off-tokens `off`, `false`, `0`, `no`, `disabled`
  (case-insensitive).
- When the var is **absent**, the feature falls back to its built-in default
  (`DEFAULT_BY_FEATURE` in `web/lib/flags.ts`): **`FEATURE_AGENT` is on,
  every other feature is off** — plain Markdown browsing plus the ask-wiki
  agent, with the ingest/processing surfaces opt-in. The published container
  image bakes these same defaults in as `ENV` values, and
  [`infra/.env.example`](../infra/.env.example) lists every flag explicitly,
  so what a deployment can change is always visible.
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

### `FEATURE_UPLOAD` — File upload & folder management

Uploading Markdown/source files into the vault, and managing the spaces
(top-level folders) that organize authored content.

- **Upload:** drop `.md` files into either `raw/` (queued for AI curation) or
  directly into `authored/<space>/` as final documents (indexed inline, no AI).
- **Folder management:** the library modal's **Folders** tab (and the "Manage
  folders" sidebar button) lets you create, rename, and delete spaces. Rename
  re-keys every document under `generated/<space>/` and `authored/<space>/`
  across the shared library and each user subtree; delete removes a space and
  all its documents. These operations are vault-global and the `personal` space
  is reserved (cannot be renamed or deleted).
- **UI when off:** upload buttons in the sidebar, document toolbar, home view,
  and the Upload/Folders tabs of the library modal disappear.
- **Routes gated:** `POST /api/upload`, `POST/PATCH/DELETE /api/spaces`, and
  `POST/PATCH/DELETE /api/folders` (folders-mode folder management — the GETs
  are read paths and stay available).
- **Turn off when:** the vault is populated and organized out-of-band (CI, the
  ingest CLI, direct S3 sync) and the portal should be read-only for sources.

### `FEATURE_CURATE` — AI ingest / curation

The pipeline that turns raw uploads into structured wiki pages via Bedrock,
running in the curate Lambda.

- **UI when off:** curation controls in the sidebar and library modal
  disappear.
- **Routes gated:** `POST /api/curate/start`, `GET /api/curate/status`,
  `POST /api/curate/finalize`, `POST /api/curate/cancel`, and
  `POST /api/synthesize` (cross-cluster synthesis pass; auto-trigger via
  `FEATURE_CURATE_AUTOSYNTH`).
- **Turn off when:** you haven't deployed the curate Lambda
  (`CURATE_LAMBDA_ARN` unset) or don't want LLM-generated content.
- **Depends on:** `CURATE_LAMBDA_ARN`, `CURATE_LAMBDA_REGION`,
  `lambda:InvokeFunction` permission when on.

### `FEATURE_REINDEX` — Re-index

Rebuilding the vault's generated `index.md` / search metadata from S3.

- **UI when off:** the re-index button in the sidebar and library modal
  disappears.
- **Routes gated:** `POST /api/reindex`, and `POST /api/managed/reconcile`
  (managed-mode page-record reconciliation — the same "rebuild derived state
  from S3" trust level).
- **Turn off when:** indexes are maintained by the ingest pipeline only and
  you don't want portal users triggering S3 writes.

### `FEATURE_EDITOR` — Page CRUD

Creating, editing, and deleting wiki pages from the portal.

- **UI when off:** "New page" (sidebar) and "Edit" buttons (document toolbar,
  generated-doc reader) disappear.
- **Routes gated:** `POST /api/docs`, `PUT /api/docs/{id}`,
  `DELETE /api/docs/{id}`, and `POST /api/docs/reparent` (managed-mode
  re-parenting — a frontmatter edit, so it carries editor trust).
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

Planned Phase 8 (static HTML publishing) and Phase 9 (personal site + shareable
agent persona — see [`specs/personal-persona-agent.md`](../specs/personal-persona-agent.md)).

- **UI when off:** nothing yet.
- **Routes gated:** none yet — the flag is reserved so deployments can opt out
  before the feature ships. Phase 9's public routes (`GET /p/[slug]`,
  `POST /api/p/[slug]/chat`) are unauthenticated by design, so gating them
  correctly is a hard prerequisite before either phase ships — see the open
  question in the Phase 9 spec about whether persona chat needs its own
  dedicated flag separate from static publishing.

### `FEATURE_IMAGE_PROXY` — External-image proxy for HTML documents

Server-side proxy that fetches external `<img>` targets on the reader's
behalf so imported HTML documents render without the browser making
outbound requests (plan 028). When off, the vault-links transform strips
external images entirely.

- **UI when off:** no dedicated UI — external images in HTML documents are
  stripped at render time instead of proxied.
- **Routes gated:** `GET /api/image-proxy`.
- **Turn off when:** you don't want the server making outbound HTTP fetches
  at all (strictest posture; this is why it defaults off).
- **Security:** the route requires a session (when the auth gate is on) and
  applies SSRF protections — private/loopback/CGNAT IP blocking with DNS
  pre-validation, per-hop redirect validation, image-only content types
  (no SVG), a 5 MB size cap, and a 5 s timeout.

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
