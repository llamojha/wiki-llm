# Session Memory: Vaultmark Remotion Video

Date: 2026-05-23
Repo: `/Users/amllamojha/Dev/personal/wiki-llm`

## Context

Vaultmark is the active product in this repo. The active implementation is the Next.js app in `web/`, with S3-backed Markdown content and TypeScript ingest tooling. The user asked to build a Remotion video for the product and pointed to the Remotion AI skills documentation.

## Work Completed

- Added a new Remotion workspace package under `video/`.
- Updated `pnpm-workspace.yaml` to include `video`.
- Installed Remotion dependencies and updated `pnpm-lock.yaml`.
- Added the Remotion composition entrypoints:
  - `video/src/index.ts`
  - `video/src/root.tsx`
  - `video/src/website-product-video.tsx`
- Added `video/package.json` scripts:
  - `capture`
  - `studio`
  - `dev`
  - `compositions`
  - `still`
  - `render`
  - `typecheck`
- Added `video/scripts/capture-website-screenshots.mjs` to start the real Next.js app and capture UI screenshots with Playwright.
- Rendered outputs:
  - `video/out/poster.png`
  - `video/out/vaultmark-product-video.mp4`

## Important Correction

The first video version used synthetic UI panels. The user asked why it was not using the actual website. The video was then reworked to use actual website screenshots from the running Next.js app.

The current Remotion root uses `WebsiteProductVideo`, which reads screenshots from:

- `video/public/screens/home.png`
- `video/public/screens/ask-wiki.png`
- `video/public/screens/upload.png`
- `video/public/screens/search.png`
- `video/public/screens/editor.png`

## Vault Values

The repo already has these values in `web/.env.local`:

```env
VAULT_BUCKET=vaultmark
VAULT_PREFIX=project-vaultmark
VAULT_REGION=us-east-1
```

AWS checks confirmed the prefix has populated content:

- `project-vaultmark/authored/...`
- `project-vaultmark/generated/...`

The initial capture script incorrectly defaulted `VAULT_REGION` to `eu-central-1`, which caused S3 redirect errors and empty UI captures. It was patched to default to:

```js
VAULT_BUCKET: process.env.VAULT_BUCKET || 'vaultmark'
VAULT_PREFIX: process.env.VAULT_PREFIX || 'project-vaultmark'
VAULT_REGION: process.env.VAULT_REGION || 'us-east-1'
```

## Verification Run

These passed during the session:

```bash
pnpm --filter @vaultmark/video typecheck
pnpm --filter @vaultmark/video compositions
pnpm --filter @vaultmark/video still
pnpm --filter @vaultmark/video render
```

`pnpm --filter @vaultmark/video capture` succeeded after setting the correct vault values and showed populated counts:

- 204 indexed docs
- 170 authored docs

## Current Caveat

Resolved after resuming:

- `pnpm --filter @vaultmark/video capture` completed against the populated S3 vault.
- `home.png` shows 204 indexed docs, 170 authored docs, and real sidebar spaces.
- `search.png` was recaptured after extending the search wait to `3_000ms`; it now shows actual search results for `index`.
- `pnpm --filter @vaultmark/video render` completed and wrote the final MP4.

Current outputs:

- `video/out/poster.png` — 206 KB
- `video/out/vaultmark-product-video.mp4` — 19 MB

Later update:

- The video was tightened from 75s to a 60s target.
- `video/src/root.tsx` now sets `VIDEO_DURATION_IN_FRAMES = 1800`.
- `video/src/website-product-video.tsx` now uses shorter scene timings, sharper copy, and animated zoom/pan motion over the real UI screenshots.
- `video/README.md` was updated to describe the 60-second composition.
- A new render completed:
  - `video/out/poster.png` — 207 KB
  - `video/out/vaultmark-product-video.mp4` — 18 MB

Latest update:

- Cursor/click overlays were removed at the user's request.
- UI scenes now use `ZoomPath` regions to zoom into relevant areas instead.
- The latest render completed:
  - `video/out/poster.png` — 204 KB
  - `video/out/vaultmark-product-video.mp4` — 20 MB

Audio/music update:

- Added `video/scripts/generate-audio.mjs`.
- Added `pnpm --filter @vaultmark/video audio` to generate local audio assets.
- Generated voiceover with macOS `/usr/bin/say`, then converted it with `/usr/bin/afconvert`.
- Generated a 60s procedural WAV music bed.
- Wired both tracks into `video/src/website-product-video.tsx` with Remotion `<Audio />`.
- Added burned-in narration captions timed to the 60s edit.
- Current audio assets:
  - `video/public/audio/voiceover.txt` — 764 B
  - `video/public/audio/voiceover.aiff` — 2.1 MB
  - `video/public/audio/voiceover.wav` — 2.1 MB, about 50.74s
  - `video/public/audio/music-bed.wav` — 5.0 MB, 60s
- Latest render with audio completed:
  - `video/out/poster.png` — 221 KB
  - `video/out/vaultmark-product-video.mp4` — 21 MB

If recapturing later, use:

```bash
pnpm --filter @vaultmark/video capture
pnpm --filter @vaultmark/video audio
pnpm --filter @vaultmark/video render
```

Capture is expected to be slow because it starts the Next.js dev server, queries S3, and waits after each route/state capture.

## Files To Review

- `video/scripts/capture-website-screenshots.mjs`
- `video/scripts/generate-audio.mjs`
- `video/src/website-product-video.tsx`
- `video/src/root.tsx`
- `video/package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`

## Git State Noted

Before this memory was written, `git status --short` showed:

```text
 M pnpm-lock.yaml
 M pnpm-workspace.yaml
?? video/
```

After this memory file, `.memory/sessions/2026-05-23-vaultmark-remotion-video.md` is also new.

Later status still showed:

```text
 M pnpm-lock.yaml
 M pnpm-workspace.yaml
?? .memory/sessions/2026-05-23-vaultmark-remotion-video.md
?? video/
```
