# Plan 030: Mobile-responsive portal (drawer sidebar, adaptive overlays)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 48c90a5..HEAD -- web/app/globals.css web/components/app-shell.tsx web/components/sidebar.tsx web/components/top-bar.tsx web/components/chat-panel.tsx web/components/search-palette.tsx`
> Structural drift in the app-shell grid or the overlay CSS blocks means the
> selectors and line references below must be re-derived before starting.
> (`grep -c '@media' web/app/globals.css` should print `0` — if it doesn't,
> someone started responsive work already; reconcile before proceeding.)

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED (visual-regression risk on desktop; new client state in the
  shell; e2e selectors must keep working)
- **Depends on**: PR #82 merged (this plan pins its drift check to that tip);
  nothing else
- **Category**: feature / UX
- **Planned at**: commit `48c90a5`, 2026-07-10

## Why this matters

The portal is desktop-only today: `web/app/globals.css` (1,944 lines) contains
**zero media queries**, and the app shell is a fixed two-column grid
(`grid-template-columns: var(--sidebar-w) 1fr` with `--sidebar-w: 268px`).
On a phone the sidebar consumes most of the viewport, the top bar's
search/scope/actions overflow, and the fixed-width chat panel (420px) and
library modal are unusable. A wiki you can't check from your phone loses half
its value as a personal knowledge base.

This is also the first deliberate **departure from the `portal/` prototype's
layout** — pixel parity was signed off for desktop; the prototype has no
mobile design to be faithful to. Decisions below fill that gap; don't consult
`portal/` for mobile intent, it has none.

## Design decisions (adjudicated here, so code doesn't relitigate)

1. **One breakpoint: 768px.** Below it: drawer sidebar, full-screen overlays,
   collapsed top bar. At/above it: today's layout, byte-identical. No tablet
   middle tier in v1 — a second breakpoint doubles the test matrix for
   marginal benefit. Express as a CSS custom breakpoint used consistently:
   `@media (max-width: 767px)`.
2. **Sidebar becomes an overlay drawer, not a push layout.** The grid drops
   to one column; the sidebar slides over content with a scrim, toggled by a
   hamburger button in the top bar. State lives in `AppShell` (one
   `sidebarOpen` boolean) and is expressed as a `data-sidebar="open"`
   attribute on the shell root — matching the existing `data-density` /
   `data-reader` attribute convention, so CSS stays the styling authority.
3. **Overlays go full-screen under the breakpoint**: chat panel, search
   palette, and the library modal each become `inset: 0` (below the header
   where applicable). CSS-only changes; no component logic.
4. **Drawer auto-closes on navigation** (tapping a doc in the tree closes the
   drawer) — the one behavior wire-up beyond the toggle itself.
5. **Touch targets**: tree rows and top-bar icon buttons get a ≥40px hit area
   under the breakpoint via padding, not layout rewrites.
6. **Out of v1**: swipe gestures, PWA/manifest/offline, mobile-specific
   editor affordances (the editor remains usable but unoptimized), TOC on
   mobile (hide it under the breakpoint — it already competes for space).

## Current state (at `48c90a5`)

- `web/app/globals.css` — all layout. Key blocks: `:root` vars (`--header-h:
  44px`, `--sidebar-w: 268px`, lines ~46-47); app grid (~99-101); topbar
  (~159+); search palette overlay (`position: fixed; inset: 0`, ~688);
  chat panel (`position: fixed; width: 420px`, ~865); chat FAB (~1090);
  library modal; toast stack (~264). Theming/density via root `data-*`
  attributes — follow that pattern.
- `web/components/app-shell.tsx` — client shell; owns `chatOpen`,
  `uploadOpen`, etc. Gets `sidebarOpen` here. Renders `Sidebar`, `TopBar`,
  overlays.
- `web/components/sidebar.tsx`, `top-bar.tsx` — presentational; top bar gains
  the hamburger (rendered only under the breakpoint via CSS, not JS
  media-query hooks — no `window.matchMedia` state unless unavoidable).
- Next.js App Router already emits the default
  `<meta name="viewport" content="width=device-width, initial-scale=1">` —
  verify in Step 1; add an explicit `export const viewport` to
  `web/app/layout.tsx` only if the default is missing or wrong.
- E2E: `playwright.config.ts` runs three projects, all `Desktop Chrome`.
  Specs select by CSS class and text; class names are load-bearing.

## Commands you will need

| Purpose   | Command                        | Expected on success |
|-----------|--------------------------------|---------------------|
| Typecheck | `pnpm typecheck`               | exit 0 |
| Lint      | `pnpm lint`                    | 0 errors (11 pre-existing warnings OK) |
| Unit      | `pnpm test:unit`               | all pass |
| E2E       | `pnpm build && pnpm test:e2e`  | all pass (incl. new mobile project) |
| Media-query count | `grep -c '@media' web/app/globals.css` | > 0 after Step 2 |

## Scope

**In scope**:
- `web/app/globals.css` — all responsive CSS (append a clearly-marked
  `/* ───── Mobile (≤767px) ───── */` section; do not rewrite desktop rules)
- `web/components/app-shell.tsx` — `sidebarOpen` state, `data-sidebar`
  attribute, scrim element, close-on-navigate
- `web/components/top-bar.tsx` — hamburger button (hidden ≥768px via CSS)
- `web/components/sidebar.tsx` — only if the drawer needs a close affordance
- `web/app/layout.tsx` — explicit viewport export iff needed (Step 1)
- `playwright.config.ts` + one new `tests/e2e/mobile.spec.ts`

**Out of scope**:
- Any API route or `web/lib` module — this plan is UI-only.
- Theme plugin CSS (`web/themes/`) — themes are color tokens; layout is
  globals.css's job. Verify no theme overrides layout before assuming.
- Editor mobile optimization, TOC on mobile, gestures, PWA (v1 exclusions).
- Desktop visual changes of ANY kind — every rule lands inside the
  breakpoint media query or on `[data-sidebar]` selectors inert on desktop.
- Renaming existing CSS classes (e2e selectors depend on them).

## Git workflow

- Branch: `feat/030-mobile-responsive` (from `main` after #82 merges)
- Commit per step; each commit typechecks and passes the full e2e suite.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Viewport + breakpoint scaffolding

Confirm the rendered HTML includes the default viewport meta
(`pnpm dev`, view source); add `export const viewport` to `layout.tsx` only
if absent. Append the mobile CSS section header to `globals.css` with the
media query shell and a comment stating the one-breakpoint decision.

**Verify**: desktop rendering byte-identical (`pnpm build && pnpm test:e2e`
green — nothing has visibly changed yet).

### Step 2: Drawer sidebar

- `AppShell`: add `sidebarOpen` (default false), `data-sidebar={sidebarOpen ?
  'open' : 'closed'}` on the shell root, scrim `<div className="sidebar-scrim"
  onClick={close}>`, and close-on-navigate inside the existing `openDoc`
  callback (one `setSidebarOpen(false)` — note `openDoc`'s dependency array).
- CSS (inside the breakpoint): grid → one column; `.sidebar` →
  `position: fixed`, off-canvas via `transform: translateX(-100%)`,
  `transition`, slides in under `[data-sidebar="open"]`; scrim fades in;
  `prefers-reduced-motion` disables the transition.
- Top bar: hamburger button first in the bar, `display: none` ≥768px.

**Verify**: `pnpm typecheck`; full e2e green (desktop untouched — the
attribute is inert above the breakpoint). Manual: dev server + browser
devtools at 390×844 — drawer opens/closes, scrim dismisses, tapping a doc
closes the drawer.

### Step 3: Top bar collapse

Inside the breakpoint: hide the search input in favor of the existing
search icon-button (the palette is the mobile search surface), collapse
low-priority actions, keep the vault pill truncated with `text-overflow`.
Pure CSS; if an element has no icon-only variant, hiding it under the
breakpoint is acceptable for v1 — list what you hid in the PR description.

**Verify**: e2e green; manual check at 390px — no horizontal overflow
(`document.documentElement.scrollWidth === window.innerWidth` in devtools).

### Step 4: Full-screen overlays

Inside the breakpoint: chat panel `width: 100%; left: 0` (keep
`top: var(--header-h)`); search palette content sized to viewport; library
modal `inset: 0`. Chat FAB stays but must not overlap the chat panel's send
button when open. TOC hidden (`display: none`) per decision 6.

**Verify**: e2e green; manual pass over each overlay at 390×844.

### Step 5: Reader + touch targets

Inside the breakpoint: `.doc-wrap` horizontal padding for phones; code blocks
`overflow-x: auto` (verify — likely already true); tree rows and icon buttons
padded to a ≥40px hit box.

**Verify**: e2e green.

### Step 6: Mobile e2e project + smoke spec

Add a fourth Playwright project `mobile` using `devices['iPhone 14']`
(`testMatch: /mobile\.spec\.ts/`, same server as `chromium`). New
`tests/e2e/mobile.spec.ts` smoke coverage: (1) home renders with drawer
closed and no horizontal overflow; (2) hamburger opens drawer, doc tap
navigates and closes it; (3) search palette opens full-screen and finds a
seeded doc; (4) chat FAB visible. Keep it to smoke depth — the desktop suite
remains the behavior referee.

**Verify**: `pnpm build && pnpm test:e2e` — all four projects green.

## Test plan

- New `mobile.spec.ts` as above (the only new spec).
- Full existing suite per step — it is the desktop non-regression referee.
- Manual visual pass at 390×844 (iPhone-class) and 768/769px (boundary) in
  both light and dark themes, plus one theme plugin (`autumn`) to confirm
  themes don't fight the layout.

## Done criteria

- [ ] `grep -c '@media' web/app/globals.css` > 0; all new rules inside the
      768px query or `[data-sidebar]`/`.sidebar-scrim` selectors
- [ ] Desktop e2e projects green with zero spec edits (proves desktop parity)
- [ ] New `mobile` project green in `pnpm test:e2e`
- [ ] No horizontal scroll at 390px on home, doc, chat, palette, library
- [ ] `pnpm typecheck` exit 0; `pnpm lint` 0 errors, no NEW warnings
- [ ] `plans/README.md` status row updated

## STOP conditions

- Drift check fails (responsive work already started, or the shell/overlay
  CSS moved).
- A desktop e2e spec needs editing to stay green — that means a desktop
  behavior changed; revert the offending step and report.
- The drawer requires `window.matchMedia`/resize listeners in more than one
  component — indicates the CSS-first approach is breaking down; stop and
  report the case rather than spreading JS media queries.
- Theme plugin CSS turns out to override layout properties (breaks the
  "themes are color tokens" assumption) — report before working around it.
- You are tempted to redesign a desktop element "while you're in there" —
  record it; do not do it here.

## Maintenance notes

- The 768px breakpoint and the `data-sidebar` attribute are the contract;
  future mobile work extends the marked CSS section rather than scattering
  media queries.
- If a tablet tier is ever added, it gets its own decision record — don't
  grow this plan.
- Deliberate v1 gaps to revisit: mobile editor ergonomics, TOC access on
  mobile (maybe a collapsible sheet), swipe-to-close drawer, PWA manifest.
- `docs/` has no UI/UX doc today; if one appears, the breakpoint decision
  belongs there.
