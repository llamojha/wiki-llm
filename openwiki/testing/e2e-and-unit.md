# Testing strategy: unit + e2e against a mock S3

## Unit tests (vitest)

`web/lib/__tests__/*.test.ts`, run via `pnpm test:unit` (`vitest run`).
These target pure functions in `web/lib/` — path/key rules, frontmatter
parsing, scope resolution, flag resolution, vault-mode sniffing, and the
folders-mode ingest policy — without touching S3 or Bedrock at all. This is
the fast, cheap gate that runs on every change to `web/lib/`.

## e2e tests (Playwright, mock S3)

`tests/e2e/*.spec.ts`, run via `pnpm test:e2e`, require a prior `pnpm build`
(with `VAULT_BUCKET` set to a placeholder — no real AWS access needed for
the build itself). The suite starts **two** Next.js servers, one with
feature flags on and one with flags off (`flags-off.spec.ts` exercises the
off state specifically), and drives the real API routes with `MOCK_S3=1`.

`web/lib/s3-mock.ts` is a complete in-memory stand-in for the S3 facade
(`getObject`, `putObject`, `listObjects`, `headObject`, ETag-based
concurrency errors, etc.) — the same interface `s3.ts` exposes, swapped in
by module resolution when `MOCK_S3=1`. This means route handlers under test
are the *actual* production code path, not a separate test-only branch —
the only thing that changes is which S3 client implementation they get.

### The one thing that can't be mocked: the curate Lambda

The curate pipeline's heavy lifting runs in a real AWS Lambda
(`infra/lambda/curate/`), which can't run against the in-memory mock or in a
local test process. `tests/e2e/curate.spec.ts` and `folders-curate.spec.ts`
work around this at the network layer: `page.route()` intercepts
`/api/curate/*` and `/api/raw` calls and returns fixed responses (a fake
`jobId`, a canned `status` progression, etc.), so the *UI flow* is exercised
end-to-end against a deterministic fake backend. Only the parts of the
route handlers that run before the Lambda invoke (validation, locking,
listing pending files) are exercised against the real route through the
`request` fixture; the Lambda invocation itself is never actually called in
tests.

### `test-seed` route

`web/app/api/test-seed/route.ts` lets e2e tests seed a vault shape into the
mock S3 store before a test runs (`seedVault` helper in
`tests/e2e/helpers.ts`). This route is hard-gated behind `MOCK_S3` — it must
never be reachable in a real deployment, and that guard is the sole thing
keeping it that way. Don't relax it to "also allow in dev" or similar; it's
a genuine production hazard if it's ever reachable against a real bucket.

## Lambda tests

`infra/lambda/curate/*.test.ts`, run independently via
`cd infra/lambda/curate && npm test` (Jest, not vitest — the Lambda is a
separate package with its own `package.json`/toolchain, not part of the
pnpm workspace). These cover manifest concurrency, path resolution, source
card parsing, and clustering — the Lambda's own pure logic, mirroring the
web side's unit-test split from its e2e/integration boundary.

## Things to watch when editing

- A change to `web/lib/s3.ts`'s public interface must be mirrored in
  `s3-mock.ts`, or e2e tests will fail (or worse, silently exercise stale
  mock behavior) without the production code path actually changing.
- New curate-related UI flows should follow the existing
  `curate.spec.ts`/`folders-curate.spec.ts` pattern: mock the Lambda-fronting
  routes at the network layer, but hit the real route for anything that
  resolves before the Lambda invoke (validation, 404s, guard behavior).
- Lambda changes need `cd infra/lambda/curate && npm run build && npm test`
  as a separate step — `pnpm test:unit`/`pnpm test:e2e` at the repo root
  never touch the Lambda's own test suite.

## Source references

- `web/vitest.config.ts`, `playwright.config.ts`.
- `web/lib/s3-mock.ts` — the mock S3 facade.
- `tests/e2e/helpers.ts`, `fixtures.ts` — seeding helpers.
- `tests/e2e/curate.spec.ts`, `folders-curate.spec.ts` — the
  network-layer-mock pattern for the Lambda-backed flow.
- `web/app/api/test-seed/route.ts` — the `MOCK_S3`-gated seeding endpoint.
- `README.md` "Verification" section — the four-command gate
  (`typecheck`, `test:unit`, `build`, `test:e2e`) run in CI.
