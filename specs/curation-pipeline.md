# Curation Pipeline Spec — Karpathy-Style Wiki Ingest

## Overview

The curation pipeline transforms raw source documents into a compounding, interlinked wiki. Inspired by Karpathy's wiki-llm pattern: the LLM doesn't just summarize files — it maintains a living knowledge graph where each new source enriches the whole.

Raw files are immutable archives. The wiki is a derived, LLM-maintained artifact. Every ingest strengthens cross-references, updates the synthesis, and flags contradictions.

## V2 Implementation Tasks

The first implementation was a single-call-per-source pipeline that asked the LLM to emit every affected Markdown file, including `index.md` and `log.md`. That proved too slow and put bookkeeping in the middle of curation. V2 splits curation into extraction, placement, targeted synthesis, and final maintenance.

- [x] 1. Add timing and reliability instrumentation.
  - Log per-file progress in Lambda.
  - Log source read, placement-hint read, Bedrock extraction, write, and manifest timings.
  - Detect stale processing jobs from S3 `LastModified` in `/api/curate/status`.

- [x] 2. Split single-source processing into source-card extraction and deterministic writes.
  - Extract a compact JSON source card from each raw file.
  - Write `_curation/source-cards/<hash>.json`.
  - Write the source summary page deterministically from the card.
  - Update `_processed.json` with the source page and source-card key.

- [x] 3. Stop asking the LLM to rewrite `index.md` and `log.md` during ingest.
  - The extraction prompt returns JSON only.
  - The Lambda no longer requests XML file blocks for per-source ingest.
  - `index.md`, space indexes, `log.md`, and lint output are reserved for the final maintenance pass.

- [ ] 4. Add placement planning.
  - Read pending source cards.
  - Assign each card to an existing user-controlled space.
  - Group cards by affected source/entity/concept/overview page.
  - Emit synthesis task records under `_curation/tasks/`.

- [ ] 5. Add targeted page synthesis.
  - Run one LLM call per affected page/topic.
  - Provide current page content plus relevant source cards.
  - Require citations back to source pages/raw keys.
  - Write only content pages, never global maintenance files.

- [x] 6. Keep Lambda work retryable and chainable.
  - Continue large batches by asynchronously invoking the same Lambda before timeout.
  - Preserve original file indexes when continuing a batch.
  - Add self-invoke IAM permission in CDK.

- [ ] 7. Add final maintenance and lint pass.
  - Rebuild `index.md` and space indexes deterministically from Markdown/frontmatter.
  - Append or rebuild `log.md` from job/task events at the end of the process.
  - Run lint checks for broken links, duplicate concepts, orphan pages, uncited claims, stale overview content, and contradiction warnings.
  - Mark the curation job complete only after final maintenance succeeds.

## Principles

1. **Raw is immutable.** Source documents stay in `raw/` forever. They are the ground truth.
2. **The wiki compounds.** Extraction creates durable source cards first; later synthesis enriches existing pages, adds cross-references, and updates the overview.
3. **LLM maintains, human curates.** The LLM extracts cards and synthesizes targeted generated pages. User-authored `wiki/` pages are indexed but never modified by AI.
4. **Contradictions are surfaced.** When new sources conflict with existing knowledge, the LLM flags it explicitly rather than silently overwriting.
5. **Everything is re-derivable.** Since raw is preserved, the entire wiki can be regenerated from scratch if needed.
6. **Bookkeeping is deterministic.** `index.md`, space indexes, `log.md`, and lint status are produced by the final maintenance pass, not by per-source LLM calls.

## Architecture

```
Browser
  → Vercel POST /api/curate/start    (creates job, invokes Lambda async)
  → Vercel GET  /api/curate/status   (polls job state from S3)

Lambda (5 min timeout)
  → For each pending file: extract a compact source card
  → Writes source card + deterministic source summary page
  → Updates manifest
  → Later: placement, targeted synthesis, final index/log/lint maintenance
```

## S3 Layout

```
s3://<bucket>/<prefix>/
  raw/                    # Immutable source documents (never deleted by AI)
  wiki/                   # User-authored pages (indexed, never AI-modified)
  <space>/                # AI-generated pages organized by space
    sources/              # Source summaries generated deterministically from source cards
    entities/             # People, orgs, products from targeted synthesis
    concepts/             # Ideas, frameworks from targeted synthesis
    ...                   # LLM may create other folders as needed
    index.md              # Space catalog (rebuilt during final maintenance)
  overview.md             # Evolving high-level synthesis (updated during synthesis/final maintenance)
  index.md                # Master catalog (rebuilt during final maintenance)
  log.md                  # Append-only history (updated during final maintenance)
  _curation/
    source-cards/         # JSON extraction cards, one per raw content hash
    tasks/                # Placement/synthesis/final-maintenance task records
  _processed.json         # Manifest of processed raw files
  _jobs/                  # Job state files
    {jobId}.json
```

## Document Identity & Versioning

Since raw files are immutable and the wiki is re-derivable, re-processing a previously ingested source produces a new version of its output pages. This is intentional:

- `_processed.json` stores the content hash at time of processing
- If a raw file is modified, its hash changes → it shows as pending again
- Re-processing overwrites the previous generated pages for that source
- The log records both the original ingest and the re-ingest
- If the LLM's output differs from the previous version (due to new wiki context, model updates, or source edits), the new version wins — the wiki reflects the latest understanding

**To force re-processing:** remove the file's entry from `_processed.json`. It will appear as pending and get re-ingested with the current wiki context, potentially producing different (better) output since the wiki has grown.

## Processed Manifest (`_processed.json`)

Tracks which raw files have been ingested and their content hash at time of processing.

```json
{
  "files": {
    "raw/article1.md": {
      "processedAt": "2026-05-16T12:00:00Z",
      "hash": "sha256:abc123...",
      "space": "articles",
      "pages": ["articles/sources/article1.md", "articles/entities/acme-corp.md"]
    }
  }
}
```

**Pending detection:**
- List all `.md` files in `raw/`
- Compare against `_processed.json`
- A file is pending if: not in manifest, OR its current hash differs from stored hash
- Pending count = new + modified files

## Job State (`_jobs/{jobId}.json`)

```json
{
  "id": "job-abc123",
  "status": "processing | done | error",
  "space": "articles",
  "total": 5,
  "completed": 3,
  "files": [
    { "key": "raw/file1.md", "status": "done", "pages": ["articles/sources/file1.md"] },
    { "key": "raw/file2.md", "status": "processing" },
    { "key": "raw/file3.md", "status": "pending" }
  ],
  "startedAt": "2026-05-16T12:00:00Z",
  "completedAt": null,
  "error": null
}
```

## Extraction Flow

For each pending raw file, one Lambda task does:

1. Read the source document from S3.
2. Read lightweight placement hints: existing page keys plus first-line summaries.
3. Make one Bedrock call that returns a compact JSON source card.
4. Write `_curation/source-cards/<hash>.json`.
5. Render and write `{space}/sources/<slug>-<hash>.md` deterministically from the source card.
6. Update `_processed.json` with hash, resolved space, source page, and source-card key.
7. Update job state.

The extraction pass does not update `index.md`, `{space}/index.md`, `overview.md`, `log.md`, entity pages, or concept pages. Those are handled by placement, targeted synthesis, and final maintenance tasks.

## Extraction Prompt

```
System:
You extract durable source cards for a Markdown knowledge base.

Return ONLY valid JSON. Do not wrap it in Markdown fences. Do not output file blocks.

Schema:
{
  "title": "short source title",
  "summary": "one concise paragraph",
  "claims": [
    { "text": "atomic factual claim", "evidence": "short quote or location from the source" }
  ],
  "entities": ["people, organizations, products, systems"],
  "concepts": ["important ideas, methods, frameworks"],
  "suggestedSpaces": ["lowercase-hyphen-space-name"],
  "suggestedPages": ["page titles that may need synthesis later"],
  "tags": ["lowercase-tags"]
}

Rules:
- Extract from the source only. Do not invent facts.
- Keep claims atomic and citation-friendly.
- Prefer 5-15 high-signal claims over exhaustive notes.
- suggestedSpaces and suggestedPages are suggestions only; do not create pages.
- Never update index.md or log.md. Those are final maintenance outputs generated by code later.

User:
Today's date: {date}
Space: {space}

Source file: {rawKey}
--- SOURCE START ---
{sourceContent}
--- SOURCE END ---

Existing page summaries in "{space}" for placement hints:
{existingPageSummaries}

Extract a source card as JSON.
```

## Reindex (Lint + Organize)

Reindex is the maintenance pass. It serves the role of Karpathy's "lint" — auditing the wiki for health, coherence, and completeness. It also indexes user-authored `wiki/` pages.

**Reindex does:**
1. Scans ALL pages (AI-generated + user-authored `wiki/`)
2. Rebuilds `index.md` and `{space}/index.md` from actual files on disk
3. Runs a Bedrock "lint" call:
   - Regenerates `overview.md` as a coherent synthesis
   - Finds contradictions between pages
   - Identifies orphan pages (no inbound links)
   - Flags stale claims superseded by newer sources
   - Suggests missing cross-references
   - Notes data gaps and suggests sources to find
4. Outputs fixes as file updates (cross-reference additions, overview rewrite)
5. User-authored `wiki/` pages are included in the index and overview but their content is never modified

**Reindex prompt:**
```
System:
You are a wiki maintainer. Audit the entire wiki for health and coherence.

Output file contents as <file path="...">...</file> blocks.

Produce:
1. overview.md — regenerated high-level synthesis of ALL knowledge
2. index.md — complete master catalog of all pages
3. Any cross-reference fixes (add wikilinks to pages that should reference each other)

Also report (as a comment block at the end):
- Contradictions between pages
- Orphan pages with no inbound links
- Stale claims superseded by newer sources
- Data gaps — questions the wiki cannot answer
- Suggested sources to find

Rules:
- overview.md should read like an executive briefing — synthesize, don't enumerate
- index.md must include ALL pages (AI-generated AND user-authored wiki/ pages)
- Never modify user-authored wiki/ page content — only add them to the index
- Use [[Page Title]] wikilinks in overview where relevant
- Flag issues clearly with > [!warning] or > [!info] callouts

User:
Today's date: {date}

All pages in the wiki (title — type — first line):
{allPageSummaries}

Current overview.md:
{currentOverview}

Regenerate overview and index. Report issues.
```

**Reindex can be triggered:**
- Manually from the UI (Re-index tab)
- Automatically after a curate batch completes (optional)
- On a schedule (future)

## Space Assignment

Spaces are user-controlled boundaries. Within a space, the LLM decides all folder structure.

- If the user selects a specific space before processing → files go there
- If files are in root `raw/` with no space context → the ingest prompt includes all space names and the LLM picks one (or the user pre-selects)
- `structure.json` tracks which spaces exist and their labels
- New spaces can be created by the user; the LLM doesn't create spaces autonomously

## Vercel Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /api/curate/start` | POST | `{ space }` → creates job, invokes Lambda, returns `{ jobId }` |
| `GET /api/curate/status` | GET | `?job=X` → returns job state JSON |
| `POST /api/curate/cancel` | POST | `{ jobId }` → marks job cancelled |
| `GET /api/raw` | GET | `?space=X` → returns pending files (raw/ vs _processed.json) |
| `POST /api/reindex` | POST | `{ space? }` → triggers reindex (lint + organize) |

## Lambda Structure

```
infra/lambda/curate/
├── index.ts          # Handler: iterates pending files, calls ingest per file
├── ingest.ts         # Single-source Karpathy-style ingest (one Bedrock call)
├── bedrock.ts        # Bedrock converse client
├── s3.ts             # S3 helpers
├── manifest.ts       # _processed.json read/write/hash
├── job.ts            # Job state management
├── parse.ts          # Parse <file> blocks from LLM response
└── types.ts          # Shared types
```

## IAM

Lambda execution role:
- `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on `arn:aws:s3:::vaultmark` and `arn:aws:s3:::vaultmark/*`
- `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on:
  - `arn:aws:bedrock:eu-central-1:858650446023:inference-profile/eu.amazon.nova-2-lite-v1:0`
  - `arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0`

Vercel IAM user (`vaultmark-vercel`):
- Existing S3 + Bedrock permissions
- Add: `lambda:InvokeFunction` on the curate Lambda ARN

## UI Flow

1. User opens Library → Pending tab
2. UI calls `GET /api/raw?space=X` → shows pending count (new + modified raw files)
3. User clicks "Process all"
4. UI calls `POST /api/curate/start { space }` → gets `{ jobId }`
5. UI polls `GET /api/curate/status?job=X` every 3s
6. Shows progress: file names ticking from pending → processing → done
7. When all files done → shows "Complete — N files processed"
8. User can trigger reindex from Re-index tab (lint + organize pass)

## Timeout & Limits

- Lambda timeout: 5 minutes
- Bedrock Nova 2 Lite: 1M input tokens, 32K output tokens
- Expected time per file: TBD from Lambda timing logs; extraction should be substantially cheaper than v1 full-wiki output
- Max batch per invocation: bounded by measured extraction time and the 5 minute Lambda limit
- For larger batches: chain multiple Lambda invocations via job state

## Future Considerations

- **Human-in-the-loop ingest**: Adopt Karpathy's interactive style — process one file at a time, show the LLM's output, let the user guide emphasis, approve/reject pages before they're written. The current batch/parallel approach is a stepping stone; the long-term UX should support conversational ingest where the user stays involved.
- **Query-back-to-wiki (Phase 5)**: When ask-wiki produces a good answer, offer to file it back into the wiki as a new page. Explorations compound in the knowledge base just like ingested sources do.
- **Re-ingest**: Remove entry from `_processed.json` → file shows as pending → re-processed with current wiki context (may produce different/better output).
- **Bedrock AgentCore**: If tool-use patterns become complex, migrate to managed agent runtime.
- **Parallel Lambda**: For large batches, fan out to multiple concurrent Lambdas.
- **Schedule-based reindex**: Periodic lint pass on a cron.

---

## Legacy Implementation Notes

The initial Lambda implementation moved processing out of Vercel but kept a v1 curation model where each raw source asked the LLM to emit every affected file. V2 supersedes that model with the task list at the top of this spec.

**Still-valid decisions:**
- Lambda-first (not inline) due to Vercel timeout constraints
- Raw files immutable, tracked via `_processed.json` manifest (hash-based pending detection)
- Existing CDK stack (ECS/RDS/Cognito/ALB) is dead code — replaced entirely with Lambda + IAM only

**Key files:**
- `infra/lambda/curate/` (Lambda package)
- `infra-cdk/lib/infra-cdk-stack.ts` (Lambda-only CDK)
- MODIFY: `web/app/api/curate/` (start/status/cancel routes)
- MODIFY: `web/app/api/raw/route.ts` (manifest-based pending)
- MODIFY: `web/components/upload-modal.tsx` (polling UI)
- FUTURE REMOVE: `web/lib/ingest/` after Lambda curation is confirmed in production
