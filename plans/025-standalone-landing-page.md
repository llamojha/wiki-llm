# Plan 025: Standalone landing page (marketing site, decoupled from the dockerized product)

> **Executor instructions**: This is a **design-then-build plan** — Step 1
> settles three decisions (placement, stack, hosting) as a short written
> record, then the remaining steps scaffold the site. The product image and
> app must be byte-for-byte unaffected. Honor STOP conditions and update
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat f46e740..HEAD -- pnpm-workspace.yaml web/Dockerfile .github/workflows/ specs/rename-to-canopy.md`
> If the Canopy rename (Track B) has been executed, drop this plan's
> naming STOP condition and write everything Canopy-native.

## Status

- **Priority**: P3 (blocks nothing; belongs to Track B's go-public push)
- **Effort**: M
- **Risk**: LOW — additive; the one hazard is coupling into the product
  build, which this plan explicitly forbids
- **Depends on**: the **Canopy rename decision** is made
  (`specs/rename-to-canopy.md`) but not executed — see STOP conditions; no
  code-plan dependencies
- **Category**: go-public / marketing
- **Planned at**: commit `f46e740`, 2026-07-04

## Why this matters

The repo is heading public under the Canopy name (ROADMAP Track B). Today
the only "front door" is the README. A landing page — what the product is,
screenshots, a copy-paste quickstart — is the standard go-public artifact,
and the maintainer wants it **separate from the dockerized product**: the
shipped container must stay a portal, not grow marketing routes, and the
site must be deployable/updatable without cutting a product release. That
separation also keeps the product image honest — no analytics, no marketing
assets, no public-web concerns inside the thing people run next to their
private notes.

## Current state

- pnpm workspace packages: `web`, `ingest`, `video` (`pnpm-workspace.yaml`) —
  adding a package is routine.
- `web/Dockerfile` builds only the `web` app (standalone output,
  `CMD ["node", "web/server.js"]`); nothing currently pulls in a sibling
  package, and nothing may start to.
- Branding inputs: name is **Canopy** (decided, unexecuted —
  `specs/rename-to-canopy.md`); the tagline needs a Canopy-native rewrite
  (open question in that spec — this plan is the natural forcing function);
  **domain/org availability for "Canopy" is unverified** and it's a crowded
  name (operator note) — domain purchase is an operator decision, not this
  plan's.
- Repo rule that binds this plan: **no deployment-specific values in the
  repo** (it's going public) — hosting config must be generic
  (`docs/`-style guidance), with secrets/IDs in CI secrets or the host's
  dashboard, never committed.
- Design language to reuse: plain CSS, IBM Plex Sans/Serif + JetBrains Mono
  (`web/app/globals.css`, `next/font` config) — the site should look like
  the product's sibling, not a template.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Workspace sanity | `pnpm install` | lockfile updates only for the new package |
| Product unaffected | `pnpm build && pnpm test:e2e` | green, identical to before |
| Image unaffected | `docker build -f web/Dockerfile .` | builds; image contents unchanged w.r.t. site/ |
| Site build | `pnpm --filter site build` | static output directory produced |

## Scope

**In scope**:
- Decision record: `specs/landing-page.md` (short — the three decisions +
  content outline; this is not a Track C-scale design spec)
- `site/` workspace package: the landing page itself (static)
- A CI job that builds (and, once the operator wires a target, deploys) the
  site independently of the product pipeline
- Screenshot/asset production process (against the `MOCK_S3=1` seeded portal)

**Out of scope**:
- Domain purchase / DNS / choosing the final host account — operator
  decisions; the plan documents the options and ships a host-agnostic
  static build.
- Docs *site* (rendered `docs/`) — a later iteration can add it; v1 links to
  the GitHub docs.
- Blog, analytics, newsletter — not before launch; if analytics ever lands
  it must stay on the site, never in the product.
- Phase 8/9 publishing features (user-content HTML) — unrelated pipeline.

## Git workflow

- Branch: `advisor/025-landing-page`
- Commits: decision record first, then the site scaffold. Do NOT push or
  open a PR unless the operator instructed it.

## Steps

### Step 1: Settle the three decisions (write `specs/landing-page.md`)

Each with a short argued recommendation:

1. **Placement — same repo vs separate repo.** Recommend **same repo,
   `site/` workspace package**: one PR flow, screenshots stay in sync with
   the product they depict, no second repo to keep public-clean. The
   separation requirement is satisfied at the *artifact* level (own build,
   own deploy, absent from the Docker image), not the repo level. Record
   the counter-case (separate repo if marketing iteration outpaces product
   review) so it's a known revisit.
2. **Stack.** Options: (a) plain `index.html` + CSS — zero deps, matches
   the plain-CSS ethos, but loses `next/font`/component reuse and gets
   painful past one page; (b) **Next.js static export (`output: 'export'`)
   — recommended**: same framework already pinned in the repo, reuses the
   font setup and design tokens, emits pure static files (no server, no
   image in any registry), trivially hosted anywhere; (c) Astro/other SSG —
   rejected: new tool in a repo whose steering pins the stack. Constraint
   either way: **static output only** — if it needs a server, it's drifting
   toward being a second product.
3. **Hosting target (documented, not committed).** Compare GitHub Pages
   (free, natural for an OSS repo, custom domain OK), S3+CloudFront
   (matches the product's AWS posture; more setup), Vercel (nicest DX;
   ties the OSS front door to a third-party account). Recommend **GitHub
   Pages via Actions** as the default recipe, with the others as
   documented alternates. No account IDs, bucket names, or tokens in the
   repo — deploy credentials live in repo/environment secrets.

Also in the record: the **content outline** — hero (name + rewritten
tagline), what-it-is in three sentences, 3–4 feature blocks matching real
flag surfaces (browse/search, ask-your-wiki agent, AI curation, self-host),
a screenshot or short capture, quickstart (`docker run …` against the
published image), links (GitHub, docs, deploy guides), license note. Writing
the hero forces the tagline question from `specs/rename-to-canopy.md` —
propose 2–3 candidates there rather than deciding unilaterally.

### Step 2: Scaffold `site/`

- New workspace package `site/` (added to `pnpm-workspace.yaml`): Next.js
  static export, no `app/api/`, no runtime env vars. Reuse the IBM Plex /
  JetBrains Mono `next/font` setup and port the design tokens (colors,
  type scale) from `web/app/globals.css` — copy the tokens, don't import
  across packages (the site must never create a build edge into `web/`).
- Content per the Step 1 outline. Placeholder screenshot slots are fine in
  this pass if asset production (Step 3) is deferred.
- Prove the separation: `docker build -f web/Dockerfile .` after the
  scaffold — the image must not contain or require anything from `site/`
  (check the Dockerfile's COPY globs; if a root-level `COPY . .` exists,
  add `site/` to `.dockerignore` and say so in the PR notes).

### Step 3: Screenshots/assets

Boot the portal with `MOCK_S3=1` and the e2e seed content, capture the
browse view + ask-wiki panel at a consistent viewport (Playwright's
screenshot API keeps this reproducible — commit the capture script next to
the assets). Optimize to web-appropriate sizes; total site payload target
under ~1 MB. Seeded mock content only — never a real vault (the operator's
actual notes must not end up in marketing assets).

### Step 4: CI job

Add a `site` job (own workflow file, path-filtered to `site/**`): install →
build → upload the static artifact. Include the `deploy-pages` step wired to
GitHub Pages but note it activates only when the operator enables Pages on
the repo — which cannot happen before the repo is public anyway. The product
CI jobs are untouched.

## Test plan

- `pnpm build && pnpm test:e2e` — product suite green, proving zero product
  impact.
- `pnpm --filter site build` — static export succeeds; output contains no
  references to env vars or the product's runtime.
- Serve the export locally (`npx serve site/out`) — pages render, links
  resolve, no external requests except fonts if self-hosting fonts is
  skipped (recommend self-hosted via `next/font`, so: none).
- Docker image build unchanged (Step 2's check).

## Done criteria

- [ ] `specs/landing-page.md` records the three decisions + content outline
      + tagline candidates
- [ ] `site/` builds to a purely static artifact, independent of `web/`
- [ ] Product build, e2e, and Docker image provably unaffected
- [ ] CI builds the site on `site/**` changes only; deploy step documented,
      operator-armed
- [ ] No deployment-specific values or secrets committed
- [ ] `plans/README.md` status row updated

## STOP conditions

- **The Canopy rename is not yet executed** (check the drift command): build
  the site Canopy-native (it's new copy — nothing to rename later), but do
  NOT wire any public deploy, and flag in the PR notes that launch is gated
  on Track B (rename pass + name/domain re-verification). If the operator
  has since changed the name decision, stop entirely and ask.
- Reusing the design tokens requires importing from `web/` (rather than
  copying) — copy them and note the duplication; do not create the
  cross-package edge.
- Any step would put a credential, account ID, or personal domain in the
  repo — stop and move it to secrets/docs.

## Maintenance notes

- When the rename pass executes, this site is already Canopy-native — add it
  to the rename spec's final-grep checklist anyway.
- Screenshots go stale with every UI change; the committed capture script is
  the refresh path — consider re-running it as part of release rituals, not
  CI (flaky-pixel churn isn't worth automating on every PR).
- If a docs site becomes wanted, extend `site/` rather than adding a third
  surface.
