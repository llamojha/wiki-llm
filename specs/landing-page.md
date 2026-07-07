# Standalone landing page — decision record

> **Status**: DESIGN (plan 025). This is the decision record (placement, stack,
> hosting, content outline, tagline candidates). The `site/` scaffold (Steps
> 2–4) is the **build follow-up**, and it is **gated on the Canopy rename**
> (Track B, `specs/rename-to-canopy.md` — decided, *not yet executed*). Per this
> plan's STOP condition: build Canopy-native when scaffolding, but **wire no
> public deploy** until the rename lands and the name/domain are re-verified.
> The shipped Docker product must stay a portal — never grow marketing routes.

## Why

The repo is heading public under **Canopy**. The only front door today is the
README. A landing page (what it is, screenshots, copy-paste quickstart) is the
standard go-public artifact, and it must be **separate from the dockerized
product**: the container stays a portal (no analytics, no marketing assets, no
public-web concerns next to people's private notes), and the site deploys/updates
without cutting a product release.

## Decision 1 — Placement: same repo, `site/` workspace package

**Recommend: same repo, new `site/` pnpm workspace package.** One PR flow;
screenshots stay in sync with the product they depict; no second repo to keep
public-clean. The separation requirement is met at the **artifact** level (own
build, own deploy, **absent from the Docker image**), not the repo level.

*Counter-case to revisit*: split to a separate repo **if** marketing iteration
starts outpacing product review cadence. Recorded so it's a known revisit, not
a silent default.

## Decision 2 — Stack: Next.js static export (`output: 'export'`)

| Option | Verdict |
|---|---|
| (a) plain `index.html` + CSS | zero deps, matches the plain-CSS ethos — but loses `next/font`/token reuse, painful past one page |
| (b) **Next.js static export** | **recommended** — same pinned framework, reuses the IBM Plex/JetBrains Mono `next/font` setup and design tokens, emits pure static files (no server, no image), hosts anywhere |
| (c) Astro / other SSG | rejected — a new tool in a repo whose steering pins the stack |

**Hard constraint either way: static output only.** If the site ever needs a
server, it's drifting toward being a second product — stop and reconsider.

## Decision 3 — Hosting: GitHub Pages via Actions (documented, not committed)

| Target | Notes |
|---|---|
| **GitHub Pages via Actions** | **recommended default** — free, natural for an OSS repo, custom domain OK |
| S3 + CloudFront | matches the product's AWS posture; more setup |
| Vercel | nicest DX; ties the OSS front door to a third-party account |

**No account IDs, bucket names, domains, or tokens in the repo** (public-repo
rule). Deploy credentials live in repo/environment secrets or the host
dashboard. The CI `deploy-pages` step ships **operator-armed** — it activates
only when the operator enables Pages, which can't happen before the repo is
public anyway.

## Content outline

- **Hero**: Canopy name + rewritten tagline (candidates below) + one-line
  what-it-is + primary CTA (`docker run` quickstart / GitHub).
- **What it is** — three sentences: Markdown-in-S3 as the durable knowledge
  layer; a portal that renders, searches, and answers questions grounded in
  your own docs; self-hosted, your bucket, no lock-in.
- **Feature blocks (3–4, matched to real flag surfaces so copy never oversells)**:
  1. **Browse & search** your Markdown (always-on read path).
  2. **Ask your wiki** — a Bedrock/Nova agent answers with citations
     (`FEATURE_AGENT`).
  3. **AI curation** — turn raw notes into structured pages (`FEATURE_CURATE`).
  4. **Self-host in minutes** — one container, point it at an S3 bucket.
- **Screenshot / short capture**: browse view + ask-wiki panel (Step 3 —
  produced against the `MOCK_S3=1` seeded portal, **never a real vault**).
- **Quickstart**: `docker run` against the published image (host-agnostic).
- **Links**: GitHub, docs, deploy guides, license note.

## Tagline candidates (forcing the `rename-to-canopy.md` open question)

The current Canopy tagline leans on "vault" imagery, which doesn't carry to
"Canopy." Candidates (Canopy = shelter/overview/growth imagery), for the
maintainer to choose in the rename spec:

1. **"Canopy — your Markdown, searchable and answerable, on your own S3."**
   (plain, benefit-first, no strained metaphor)
2. **"Canopy — a living canopy over your team's Markdown: browse, search, ask."**
   (leans into the name; "living" nods to growth)
3. **"Canopy — the knowledge layer above your files. Markdown in, answers out."**
   (canopy-as-layer; pairs with the "durable knowledge layer" philosophy line)

Recommend **#1** for the hero (clarity beats cleverness on a landing page), with
#3's "knowledge layer above your files" as supporting copy. Final choice belongs
in `specs/rename-to-canopy.md`.

## Build follow-up (Steps 2–4, gated)

When the Canopy rename executes, scaffold:

- **`site/`** workspace package (added to `pnpm-workspace.yaml`): Next.js static
  export, **no `app/api/`**, no runtime env vars. Reuse the `next/font` setup;
  **copy** the design tokens from `web/app/globals.css` — do **not** import
  across packages (the site must never create a build edge into `web/`).
- **Docker separation check**: after scaffolding, `docker build -f web/Dockerfile .`
  must not contain or require anything from `site/`. `.dockerignore` exists;
  add `site/` to it and confirm the Dockerfile's COPY globs don't pull it in.
- **CI**: a `site` job in its own workflow file, path-filtered to `site/**`
  (install → build → upload artifact), with a `deploy-pages` step that is
  operator-armed. Product CI jobs untouched.
- **Assets**: a committed Playwright capture script (consistent viewport,
  reproducible), seeded mock content only, total payload < ~1 MB.

**Launch gate**: this site is Canopy-native by construction, but no public
deploy is wired until the rename pass lands and **Canopy name/domain
availability is re-verified** (operator decision — the name is crowded).

## Done (this record) vs deferred

- ✅ Three decisions argued (placement / stack / hosting) + content outline +
  tagline candidates → **this file**.
- ⏳ `site/` scaffold + CI + assets → the build follow-up above, gated on the
  Canopy rename (Track B). No product/image/CI change ships with this record.
