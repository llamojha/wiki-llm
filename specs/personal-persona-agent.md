# Phase 9 — Personal Site & Shareable Agent Persona

**Milestone:** Deferred — after Phase 8 (HTML Publishing). Depends on the Phase 5 agent-scope machinery (already shipped) and benefits from, but does not strictly require, Phase 8's static rendering pipeline.

**Status:** Not started. This is a forward-looking spec capturing the feature shape so implementation can begin without re-deriving the design.

## Goal

Let a user curate a subset of their vault — specific pages, and/or whole spaces — and publish it as a public, link-shareable "personal site": a small set of read-only pages plus a chat widget backed by an ask-wiki agent that is **grounded only in the selected content**. The result is a shareable persona ("ask me about X") a user can hand to a recruiter, collaborator, or community, without exposing the rest of their private vault.

## User Story

As a user, I want to pick which of my pages are public, write a short bio/intro for how the agent should introduce itself, and get a shareable URL where visitors can read those pages and ask an agent questions — with the agent strictly unable to see or cite anything I didn't select.

## Relationship to existing phases

- **Builds on Phase 5** (`web/lib/agent.ts`, `agent-tools.ts`, `agent-prompts.ts`, `scope.ts`). The scoped read/search-tool pattern (`isInAllowedScope`) already exists for `shared`/`user` scope; this phase adds a third, narrower kind of scope — an explicit **document allowlist** rather than a prefix rule.
- **Complements Phase 8** (HTML Publishing). Phase 8 governs turning one Markdown doc into a derived, disposable HTML artifact. This phase governs *which* docs get exposed publicly at all, and adds an interactive chat layer on top. Once Phase 8 ships, a persona's public pages can render through its `_site/` pipeline; until then, publish pages read-only through the existing sanitized Markdown renderer behind a new unauthenticated route.
- **Activates `FEATURE_PUBLISHING`.** `docs/feature-flags.md` already reserves this flag for "Personal site / HTML publishing" with no routes gated yet. This phase is the first to actually wire routes behind it (see Open Questions on whether it needs its own flag instead).

## Core concepts

- **Persona** — a named, shareable configuration a user creates from their own vault:
  ```json
  {
    "id": "uuid",
    "slug": "jane-on-infra",
    "displayName": "Jane Doe",
    "bio": "I write about platform engineering and on-call practices.",
    "instructions": "Answer as Jane. Be concise. Decline questions outside the selected docs.",
    "selectedDocs": ["users/jane/authored/personal/oncall-playbook.md", "..."],
    "selectedSpaces": ["projects"],
    "published": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
  ```
  A user can maintain multiple personas (e.g. a "resume" persona and a "hobby" persona) drawing from overlapping or disjoint subsets of the same vault.
- **Selection** — done through a new "Personal Site" management panel: checkboxes per document and per space. Stored as an allowlist on the persona manifest, not scattered `public: true` frontmatter flags — this keeps selection persona-scoped (the same doc can be in one persona and excluded from another) rather than vault-global.
- **Public route** — unauthenticated `GET /p/[slug]` renders the persona's bio, the list of selected pages (read-only, sanitized), and an "Ask me" chat widget.
- **Scoped agent** — `POST /api/p/[slug]/chat` runs the existing agent loop, but:
  - `search_vault` and `read_document` are filtered against the persona's `selectedDocs`/`selectedSpaces` allowlist instead of the `shared`/`user` prefix rule.
  - `propose_page` is **not included** in the tool set at all for persona chats — anonymous visitors can never trigger a write.
  - The system prompt is built from the persona's `bio`/`instructions` fields instead of (or blended with) the standard ask-wiki system prompt.

## Architecture sketch

```
users/<id>/_system/personas/<persona-id>.json   # persona manifest (allowlist, bio, publish state)
users/<id>/_system/personas/index.json          # list of this user's personas (id, slug, published)
```

```
web/app/p/[slug]/page.tsx                  # public persona site — unauthenticated, read-only
web/app/api/p/[slug]/chat/route.ts         # scoped chat — allowlist-only, no propose_page
web/app/api/personas/route.ts              # GET (list) / POST (create) — owner-only
web/app/api/personas/[id]/route.ts         # GET / PUT / DELETE — owner-only
web/components/persona-editor.tsx          # doc/space picker, bio field, publish toggle, copy-link
web/lib/persona-scope.ts                   # new: allowlist-based isInAllowedScope variant
```

`web/lib/persona-scope.ts` should mirror the shape of `isInAllowedScope` in `agent-tools.ts` rather than extend it with optional params — a persona's allow-check is a fundamentally different rule (explicit key/space membership vs. prefix inference) and conflating them risks the same kind of scope-leak bug called out in the Phase 5 v1 postmortem.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Selection model | Persona-level allowlist (doc keys + space names), not a `public` frontmatter flag | Lets one doc belong to zero, one, or multiple personas without vault-wide side effects |
| Multiple personas per user | Yes | A user may want different curated slices for different audiences |
| Auth model for public route | None — unlisted-link sharing only, consistent with the app's "no built-in auth" posture | Matches existing security stance (see `SECURITY.md`); a real access-controlled share is a SaaS-phase (Phase 6) concern |
| `propose_page` in persona chats | Disabled entirely (not just prompted against) | Anonymous visitors must never be able to trigger a vault write, even via prompt injection |
| Search/read scoping | New allowlist-based gate, not an extension of the existing prefix-based `Scope` type | Keeps the existing shared/user scope logic simple; avoids conflating "which subtree" with "which specific keys" |
| Crawlability | `noindex` by default on `/p/[slug]` | Unlisted-by-default; users can opt into discoverability later, not the reverse |
| Cost control | Per-persona/IP rate limit on `/api/p/[slug]/chat` required before this ships | This is the first route where a Bedrock-billed call can be triggered by an unauthenticated third party |

## Non-Functional Requirements

- **Rate limiting is a hard prerequisite, not a nice-to-have.** Every other Bedrock-calling route in Canopy is behind the app's own (implicitly trusted, single-user) session. This is the first unauthenticated surface that spends the vault owner's Bedrock budget. Ship with a basic token-bucket (per IP + per persona) before enabling in any real deployment.
- **Fail closed on scope.** `readDocument`/`searchVault` equivalents for personas must reject anything not explicitly in `selectedDocs`/`selectedSpaces`, mirroring the fail-closed pattern already in `agent-tools.ts::isInAllowedScope`.
- **Unpublish must be instant and complete.** Setting `published: false` (or deleting the persona) must immediately 404 both the site route and the chat route — no caching window where a revoked persona is still answerable.

## Acceptance Criteria

1. A user can create a persona, select an arbitrary subset of their pages and/or spaces, add a bio/instructions, and publish it.
2. `GET /p/[slug]` renders the persona's bio and the selected pages, read-only, sanitized, with no way to navigate to non-selected vault content.
3. `POST /api/p/[slug]/chat` answers only from the persona's allowlisted documents; asking about anything outside the allowlist produces a refusal, never a leak.
4. The persona chat agent never has `propose_page` available as a tool.
5. Unpublishing a persona (or deleting it) immediately removes public access to both the site and the chat route.
6. A user can maintain more than one persona from the same vault with independent, possibly overlapping selections.
7. Anonymous chat requests are rate-limited per persona/IP; exceeding the limit returns a clear error, not a silent hang or an uncontrolled Bedrock bill.
8. `/p/[slug]` responses include `noindex` by default.
9. Citations shown in persona chat responses link only to pages within the persona's own public site, never to the owner's private vault paths.

## Non-Goals (this phase)

- Real authentication / invite-only sharing (Phase 6 SaaS territory).
- Per-visitor personalization or visitor accounts.
- Editing vault content from the public site (read-only, always).
- Analytics/telemetry on visitor questions beyond basic usage logging already established in Phase 5.
- Replacing or subsuming Phase 8's HTML publishing — personas may eventually render through `_site/`, but this phase can ship against the existing sanitized Markdown renderer first.

## Open Questions

- Does this ship under the existing `FEATURE_PUBLISHING` flag, or does the public-unauthenticated-Bedrock-cost surface warrant a dedicated `FEATURE_PERSONA` flag so operators can enable static personal-site publishing without exposing chat, or vice versa?
- Should space-level selection auto-include future pages added to that space, or snapshot membership at publish time?
- Is a persona's `slug` user-chosen (collision risk, vanity URLs) or generated (safer, less memorable)?
- Should there be a global "kill switch" env var to disable all persona routes vault-wide, independent of individual persona `published` state?
