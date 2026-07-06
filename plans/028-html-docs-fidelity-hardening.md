# Plan 028: HTML document fidelity & hardening (022 §10 follow-ups)

> **Executor instructions**: This is a **build plan** — the deferred open
> questions from the shipped HTML-docs work (plan 022 / PR #71). Read
> `specs/html-documents.md` §9–§10 first. Each item below is independently
> shippable; they can be separate PRs. Every item touches the sanitizer trust
> boundary — treat with 002/005-level care. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git log --oneline -1 -- web/lib/html.ts web/lib/vault-links.ts` — confirm the HTML pipeline + shared link resolver (022) are present.

## Status

- **Priority**: P3 (fidelity/UX polish; v1 shipped secure-but-plain)
- **Effort**: M (sum of independent items; each S–M)
- **Risk**: MEDIUM — every item widens what rendered HTML may contain; the whole
  point of the v1 strips was security-over-fidelity
- **Depends on**: plan 022 (HTML docs) — SHIPPED (PR #71)
- **Category**: feature / security-sensitive
- **Planned at**: commit `6f2b33d`, 2026-07-05

## Why this matters

HTML docs shipped **secure but plain** (022): scripts/iframes/event-handlers
permanently stripped; and — deferred as §10 open questions — external images
stripped, inline `style=` dropped, `data:` images dropped, and no in-portal HTML
authoring. Some uploaded HTML therefore renders visually degraded. Each item
below recovers fidelity **without** reopening the permanent-strip guarantees, and
each is a deliberate, separately-reviewable widening of the trust boundary.

## Items (independent; ship separately)

1. **External-image proxy (§10 Q2).** v1 strips external `<img>` (no outbound
   requests from a doc being read — enforced in `web/lib/vault-links.ts`). Add an
   opt-in server-side image proxy so external images render without the reader's
   browser making the request. Off by default; a `FEATURE_*`/config gate. Keep
   the strip as the default.
2. **Inline `style=` allowlist (§10 Q3).** v1 drops inline styles (default
   `hast-util-sanitize` schema). Scope a **curated, safe** style-attribute
   allowlist (no `expression()`, no `url()` fetches, no `position:fixed`
   overlays) and extend the sanitize schema. Document every allowed property.
3. **`data:image/*` URIs (§10 Q5).** v1 strips `data:` (default protocol filter).
   Add a **size-bounded** `data:image/*` allow (cap bytes; images only, never
   `data:text/html`). Exported HTML often embeds images this way.
4. **Relative-link rewriting completeness (§10 Q4).** The shared resolver
   (`vault-links.ts`) already rewrites in-vault `.md`/`.html` links and strips
   external images. Audit edge cases: query/hash fragments, non-doc relative
   assets, and whether relative `<img src>` (currently kept) should resolve to a
   vault asset route.
5. **(Re-decide) In-portal HTML authoring (§9 Q1).** v1 is browse/upload-only —
   Markdown stays the canonical authored format. Only revisit if the maintainer
   explicitly wants HTML editing; default recommendation is to keep it out.

## STOP conditions

- **STOP if any change reintroduces script execution, iframes, `object`/`embed`,
  event-handler attributes, or `javascript:` URLs** — these are permanently out
  (022 §2), not "v2".
- **STOP if a second sanitizer/allowlist appears anywhere** — there must stay
  exactly one sanitize path (`web/lib/html.ts` + the shared schema); Phase 8 HTML
  publishing must share it too (022 §8).
- Each item ships with a **hostile-input test** proving the widening didn't open a
  hole (mirror `web/lib/__tests__/html.test.ts` + `tests/e2e/html-docs.spec.ts`).

## Verification

- Per item: `pnpm typecheck && pnpm test:unit && pnpm build && pnpm test:e2e`.
- Extend the sanitizer table test with the newly-allowed constructs AND a hostile
  variant that must still be stripped (e.g. `style="background:url(evil)"`,
  oversized `data:`, `data:text/html`). The `html-docs.spec.ts` hostile fixture
  must keep rendering inert.
