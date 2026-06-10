# Synthesis Pipeline Spec — Rollup Page Generation

**Status:** proposed (May 2026). Extends [`curation-pipeline.md`](curation-pipeline.md) V2 tasks 4 (placement planning) and 5 (targeted synthesis), which are checked `[ ]` in the parent spec and have no implementation today.

## Context

Today the deployed curator (`infra/lambda/curate/`) runs only the **extraction** stage of the V2 pipeline. For each raw file it writes a source-card JSON and a `generated/<space>/sources/<slug>.md` page, then stops. The comments in `ingest.ts` say so explicitly:

> `// 2. Extract one compact source card. Index/log/global synthesis happen later.`
> `// 5. Update manifest. Final index/log/lint is a separate maintenance pass.`

The "later" pass was never built. Result, as of `2026-05-30`:

| Folder | Count |
|---|---|
| `_system/source-cards/*.json` | 160 |
| `generated/wiki/sources/*.md` | 160 |
| `generated/wiki/concepts/*.md` | 4 (fossils from legacy pipeline) |
| `generated/wiki/features/*.md` | 4 (fossils) |
| `generated/wiki/projects/*.md` | 1 (fossil) |

Every `sources/*.md` cites `[[Backstage]] [[Node.js]] [[Kubernetes]]` etc. as wikilinks — all dangling, because the concept pages don't exist. The wiki has rich raw input and zero synthesized output.

## Goal

Build the second stage of the curator: read all source-cards, cluster them by topic, and produce rollup pages (`concepts/`, `features/`, `projects/`) that cite their contributing sources. Idempotent, re-runnable, cheap when nothing has changed.

## Non-Goals

- Rebuilding `_system/index.md`. Already handled deterministically by `web/lib/index-gen.ts::regenerateMasterIndex` and the existing reindex route. The synthesis pass writes content pages only; index regeneration runs after as it already does today.
- Touching `authored/*` content. Human-authored pages are never modified.
- Multi-source contradiction reconciliation. Phase 2 of synthesis; out of scope here. The Bedrock prompt may flag contradictions in the prose, but no structured reconciliation step is built yet.
- Cross-scope synthesis (mixing shared + user source-cards). Synthesis runs per-scope.

## Inputs (Already Exist)

Each source-card produced by the extraction stage carries exactly the fields synthesis needs:

```json
{
  "title": "Backstage Spike README",
  "summary": "...",
  "claims": [{ "text": "...", "evidence": "..." }],
  "entities": ["Backstage", "Node.js", "Kubernetes"],
  "concepts": ["package discovery", "plugin configuration"],
  "suggestedSpaces": ["backstage", "devops-tools"],
  "suggestedPages": ["Backstage Plugin Configuration", "GitHub Integration with Backstage"],
  "tags": ["backstage", "devops"],
  "hash": "sha256:...",
  "space": "wiki",
  "sourcePage": "generated/wiki/sources/backstage-spike-readme-0009886f.md"
}
```

`suggestedPages` is the planning hint the extraction prompt already produces and nothing consumes. **Synthesis uses it as the clustering seed** rather than inventing its own clustering algorithm.

## Architecture

```
Synthesis Lambda (separate handler, same package)
  → Load all source-cards for the target scope+space
  → Cluster: group source-cards by (normalized) suggestedPage title
  → For each cluster with >= MIN_CLUSTER_SIZE sources:
       → Build a synthesis prompt from the cluster's claims + summaries
       → One Bedrock call per cluster page
       → Deterministically write generated/<space>/<category>/<slug>.md
       → Update _system/synthesis-manifest.json with cluster hash
  → Emit synthesis-job record under _system/jobs/{jobId}.json
  → Trigger existing index regeneration after success
```

Trigger model: explicit endpoint (`POST /api/synthesize`), gated by `FEATURE_CURATE`. Not auto-fired per-file — synthesis benefits from running once per batch. **Opt-in chaining:** when `FEATURE_CURATE_AUTOSYNTH=on`, `POST /api/curate/start` invokes synthesis once after the extraction batch completes. Default off.

## Clustering

The simplest viable approach, leveraging extraction output:

1. Collect all `suggestedPages[]` values across the scope's source-cards.
2. Normalize each title: lowercase, strip articles, collapse whitespace, slugify.
3. Group source-cards by normalized title. A source-card belongs to a cluster if any of its `suggestedPages` (or `concepts`, as a fallback) normalize to the cluster's key.
4. Drop clusters with fewer than `MIN_CLUSTER_SIZE` (default 2) contributing sources — singletons stay as `sources/*.md` only.
5. Resolve category from the cluster's predominant signal:
   - If the cluster title appears in any source's `entities[]` → `concepts/` (named thing)
   - If the title contains a verb-noun pattern ("integration", "automation", "workflow") → `features/`
   - If the title matches an entry in `_system/structure.json::projects[]` (when defined) → `projects/`
   - Else default to `concepts/`

Category resolution is a heuristic. The spec accepts that it will mis-bucket occasionally; the model can override via the rollup page's `type:` frontmatter and we re-cluster on the next pass.

## Bedrock Call Shape

One call per cluster page (not per source-card). Input:

```text
You are synthesizing a wiki page titled "{title}" from {N} source documents.

For each source, you have its summary and atomic claims with evidence. Produce
a coherent {category} page that:
- Has a brief Overview section
- Organizes the source claims into themed sections, NOT a flat list
- Cites every factual claim with [n] markers matching the source order below
- Flags any direct contradictions between sources rather than picking one
- Uses [[wikilinks]] for entities/concepts shared with other cluster titles
- Returns Markdown only — no frontmatter (added by code)

Sources:
[1] {source-card 1 summary + claims}
[2] {source-card 2 summary + claims}
...
```

Output is wrapped with deterministic frontmatter (matching the existing `renderSourcePage` contract):

```yaml
---
title: "{cluster title}"
type: {concept|feature|project}
source_type: generated
sources: [{contributing sourcePage paths}]
contributing_cards: [{contributing source-card hashes}]
cluster_hash: "sha256:..."   # hash of sorted contributing_cards
tags: [{union of contributing tags}]
created: {ISO}
updated: {ISO}
---
```

## Idempotency & Re-Run

The synthesis manifest tracks what's been built:

```json
// _system/synthesis-manifest.json
{
  "clusters": {
    "concepts/backstage": {
      "clusterHash": "sha256:...",
      "contributingCards": ["sha256:0009...", "sha256:abcd..."],
      "pagePath": "generated/wiki/concepts/backstage.md",
      "synthesizedAt": "2026-..."
    }
  }
}
```

A cluster is re-synthesized iff its `clusterHash` (deterministic from the sorted set of contributing card hashes) has changed. So:

- New raw file ingested → new card → may join existing clusters → only those clusters re-synthesize.
- No new cards → re-running synthesis is a no-op, costs no Bedrock $.
- Card removed (raw deleted) → its clusters re-synthesize with the remaining N-1 sources, or are deleted if they fall below `MIN_CLUSTER_SIZE`.

## Recovery for the 160 Existing Source-Cards

This is the first-run scenario. No special migration needed — the synthesis pass operates on whatever source-cards exist. On first invocation:

1. Read all 160 cards.
2. Cluster. Expected: ~20-40 clusters based on the diversity of `suggestedPages` across the current sources (sample inspection: Backstage, GitHub Integration, Amplify, AIvaro, Kiro, etc. — clearly clustered topics).
3. Synthesize each cluster ≥ `MIN_CLUSTER_SIZE`.
4. Write to `generated/wiki/{concepts,features,projects}/`.
5. The 9 fossil pages from the legacy pipeline: leave alone if their titles don't collide with a new cluster; overwrite if they do (cluster-hash mismatch).

After the first run we expect roughly one rollup page per real topic, with each citing its 2-N source pages.

## Output Paths

Following the conventions already declared in `structure.json` and used by the fossil pages:

```
generated/<space>/concepts/<slug>.md
generated/<space>/features/<slug>.md
generated/<space>/projects/<slug>.md
```

`<slug>` is `kebab-case(normalized cluster title)`. Per-user scope mirrors under `users/<id>/generated/<space>/...`.

## Resolved Defaults

Decisions taken `2026-05-30` (locked in before implementation):

1. **`MIN_CLUSTER_SIZE = 2`.** Any topic with 2+ contributing sources gets a rollup. Maximizes coverage on the existing 160 cards (expected ~30+ rollup pages on first run). Singletons stay as `sources/*.md` only.
2. **Cluster title source ranking: `suggestedPages` first, fallback to `concepts`.** Trust the model's planning intent (the field was specifically added for this). `concepts[]` is used only when a card's `suggestedPages[]` is empty.
3. **Trigger model: separate endpoint by default, opt-in auto-chain.** `POST /api/synthesize` is the primary entry point — explicit, isolated failure modes, retryable independently of extraction. When `FEATURE_CURATE_AUTOSYNTH=on`, `POST /api/curate/start` chains into synthesis after extraction completes. Default off so prod stays conservative; local dev can toggle the convenience.
4. **`MAX_CLUSTERS_PER_RUN = 100`** (hard cap). Early-exit with a warning if clustering produces more than this — a guardrail against a future malformed extraction prompt that fragments topics. At ~30 expected clusters today, this is comfortable headroom.

## Deferred (Follow-Up Passes)

- **Wikilink reification for unreached entities.** When `[[Node.js]]` is cited by 20 sources but no source's `suggestedPages` proposes a "Node.js" rollup, the wikilink dangles. A future pass can generate stub pages from heavily-referenced entities that miss `MIN_CLUSTER_SIZE`. Out of scope for v1.
- **Cross-source contradiction reconciliation.** The Bedrock prompt may flag contradictions in prose, but no structured reconciliation step. Phase 2.

## Implementation Tasks

- [ ] 1. Add `infra/lambda/curate/synthesis.ts` exporting `runSynthesis(scope, space, jobId)`.
- [ ] 2. Add `clusterSourceCards(cards): Cluster[]` (pure function, unit-testable).
- [ ] 3. Add `buildSynthesisPrompt(cluster): { system, user }` and `parseSynthesisResponse(raw, cluster): RollupPage`.
- [ ] 4. Wire a Lambda handler entry (`SYNTHESIZE` action) alongside the existing extraction action.
- [ ] 5. Add `web/app/api/synthesize/route.ts` mirroring the curate route's job-launch shape, gated by `FEATURE_CURATE`. Add the `FEATURE_CURATE_AUTOSYNTH` chain hook to `/api/curate/start` so it fires synthesis after the batch completes when enabled.
- [ ] 6. Add `_system/synthesis-manifest.json` read/write helpers in `manifest.ts`.
- [ ] 7. Tests: clustering on a fixture of 10 source-cards (Backstage + AIvaro + GitHub overlap), idempotency on second run, cluster-hash invalidation when a contributing card is removed.
- [ ] 8. After first successful run, regenerate `_system/index.md` via the existing reindex endpoint and verify the new rollup pages appear in the agent catalog.

## Gates

Same envelope as the rest of the curator:

- `FEATURE_CURATE=on` required to expose `/api/synthesize`.
- `FEATURE_CURATE_AUTOSYNTH=on` (default off) enables auto-chaining from `/api/curate/start`.
- Lambda execution role gains no new permissions (already has S3 read/write and Bedrock invoke for `amazon.nova-2-lite-v1:0`).
- Synthesis runs only against scopes the caller owns (shared admin or self for user scope).
