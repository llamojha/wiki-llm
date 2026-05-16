# Curation Pipeline Spec — Karpathy-Style Wiki Ingest

## Overview

The curation pipeline transforms raw source documents into a compounding, interlinked wiki. Inspired by Karpathy's wiki-llm pattern: the LLM doesn't just summarize files — it maintains a living knowledge graph where each new source enriches the whole.

Raw files are immutable archives. The wiki is a derived, LLM-maintained artifact. Every ingest strengthens cross-references, updates the synthesis, and flags contradictions.

## Principles

1. **Raw is immutable.** Source documents stay in `raw/` forever. They are the ground truth.
2. **The wiki compounds.** Each ingest enriches existing pages, adds cross-references, and updates the synthesis — not just appends isolated summaries.
3. **LLM maintains, human curates.** The LLM writes and updates all generated pages. User-authored `wiki/` pages are indexed but never modified by AI.
4. **Contradictions are surfaced.** When new sources conflict with existing knowledge, the LLM flags it explicitly rather than silently overwriting.
5. **Everything is re-derivable.** Since raw is preserved, the entire wiki can be regenerated from scratch if needed.
6. **Single atomic call per source.** Each ingest is one LLM call that outputs all affected files — the wiki is always coherent after each source.

## Architecture

```
Browser
  → Vercel POST /api/curate/start    (creates job, invokes Lambda async)
  → Vercel GET  /api/curate/status   (polls job state from S3)

Lambda (5 min timeout)
  → For each pending file: single Bedrock call (Karpathy-style)
  → Writes ALL output files to S3 per source
  → Updates manifest, index, overview, log atomically
```

## S3 Layout

```
s3://<bucket>/<prefix>/
  raw/                    # Immutable source documents (never deleted by AI)
  wiki/                   # User-authored pages (indexed, never AI-modified)
  <space>/                # AI-generated pages organized by space
    sources/              # Source summaries (LLM decides subfolders within)
    entities/             # People, orgs, products (LLM decides)
    concepts/             # Ideas, frameworks (LLM decides)
    ...                   # LLM may create other folders as needed
    index.md              # Space catalog (updated every ingest)
  overview.md             # Evolving high-level synthesis (updated every ingest)
  index.md                # Master catalog (updated every ingest)
  log.md                  # Append-only history
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

## Ingest Flow (Single Call Per Source — Karpathy Style)

For each pending raw file, one Lambda invocation does:

1. Read the source document from S3
2. Read current wiki state:
   - `overview.md` (current synthesis)
   - `{space}/index.md` (space catalog)
   - `log.md` (last 20 entries)
   - All existing page titles + first-line summaries in the space
3. **Single Bedrock call** — LLM receives source + full wiki context, outputs ALL files
4. Parse `<file path="...">...</file>` blocks from response
5. Write all output files to S3 (source page, entities, concepts, updated index, updated overview, appended log)
6. Update `_processed.json` with hash + output pages
7. Update job state

**What the LLM outputs per source (all in one response):**
- `{space}/sources/<slug>.md` — structured summary with frontmatter
- `{space}/entities/<name>.md` — one per significant person/org/product (create or update)
- `{space}/concepts/<name>.md` — one per key idea/framework (create or update)
- `{space}/index.md` — updated space catalog with new entries added
- `overview.md` — updated high-level synthesis reflecting the new source
- `log.md` — full log with new entry appended

**The LLM decides folder structure within the space.** Spaces are the user-controlled boundary; everything inside is LLM-organized. It may create `people/`, `tools/`, `comparisons/`, whatever fits the content.

## Ingest Prompt

```
System:
You are a wiki maintainer for a personal knowledge base stored as markdown files.
Process a new source document and integrate it into the existing wiki.

Output ONLY file contents in XML blocks — one block per file to create or update:
<file path="space/sources/slug.md">...content...</file>

Produce:
1. {space}/sources/<slug>.md — structured summary with YAML frontmatter
2. {space}/entities/<name>.md — one per significant person/org/product (create or update)
3. {space}/concepts/<name>.md — one per key idea/framework (create or update)
4. {space}/index.md — updated catalog (preserve all existing rows, add new ones)
5. overview.md — updated high-level synthesis reflecting this new source
6. log.md — full file with new entry appended at the bottom

Rules:
- Every page needs YAML frontmatter: title, type, tags, sources, created, updated
- Link between pages using [[Page Title]] wikilinks on first mention
- Slug = lowercase, hyphens only, no special characters
- You may create subfolders within the space as you see fit (people/, tools/, etc.)
- If updating an existing page, include the FULL updated content (not a diff)
- Flag contradictions with existing content using a > [!warning] callout
- Preserve ALL existing rows in index.md — only add new rows
- Preserve ALL existing log entries — only append the new one at the bottom
- Only create entity/concept pages for things substantive enough to warrant their own page
- Prefer fewer, higher-quality pages over many thin ones

User:
Today's date: {date}
Space: {space}

Source file: {rawKey}
--- SOURCE START ---
{sourceContent}
--- SOURCE END ---

Current overview.md:
--- OVERVIEW ---
{overviewContent}
--- END OVERVIEW ---

Current {space}/index.md:
--- INDEX ---
{spaceIndexContent}
--- END INDEX ---

Current log.md (last 20 entries):
--- LOG ---
{recentLog}
--- END LOG ---

Existing pages in "{space}":
{existingPageSummaries}

Process this source and output all new/updated wiki files.
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
- Expected time per file: 15-45s (single call outputs all pages + index + overview + log)
- Max batch per invocation: ~10-12 files (to stay within 5 min)
- For larger batches: chain multiple Lambda invocations via job state

## Future Considerations

- **Human-in-the-loop ingest**: Adopt Karpathy's interactive style — process one file at a time, show the LLM's output, let the user guide emphasis, approve/reject pages before they're written. The current batch/parallel approach is a stepping stone; the long-term UX should support conversational ingest where the user stays involved.
- **Query-back-to-wiki (Phase 5)**: When ask-wiki produces a good answer, offer to file it back into the wiki as a new page. Explorations compound in the knowledge base just like ingested sources do.
- **Re-ingest**: Remove entry from `_processed.json` → file shows as pending → re-processed with current wiki context (may produce different/better output).
- **Bedrock AgentCore**: If tool-use patterns become complex, migrate to managed agent runtime.
- **Parallel Lambda**: For large batches, fan out to multiple concurrent Lambdas.
- **Schedule-based reindex**: Periodic lint pass on a cron.

---

## Implementation Plan

**Problem:** The current inline curation pipeline times out on Vercel (multiple Bedrock calls per source exceed function timeout). Solution: move processing to a Lambda (5 min timeout) invoked asynchronously, with job state in S3.

**Decisions:**
- Lambda-first (not inline) due to Vercel timeout constraints
- Free-form text with `<file path="...">` XML blocks (not tool_use) — better for multi-file markdown generation, avoids JSON-escaping overhead, 65K output token ceiling
- Raw files immutable, tracked via `_processed.json` manifest (hash-based pending detection)
- Existing CDK stack (ECS/RDS/Cognito/ALB) is dead code — replaced entirely with Lambda + IAM only

**Sequence:**

```
Browser → POST /api/curate/start {space}
  Vercel: list pending files, create _jobs/{id}.json, invoke Lambda async
  Return: {jobId}

Browser → GET /api/curate/status?job=X (poll every 3s)
  Vercel: read _jobs/{id}.json from S3
  Return: {status, completed, total, files[]}

Lambda (async, 5 min timeout):
  For each pending file:
    1. Read source + wiki context (overview, space index, log, existing pages)
    2. Single Bedrock call → free-form response with <file> blocks
    3. Parse blocks, write all output files to S3
    4. Update _processed.json and _jobs/{id}.json
```

**Tasks:**

1. Lambda scaffold — `infra/lambda/curate/` with types, XML parser, handler skeleton
2. S3 helpers — getObject/putObject/listObjects + manifest + job state management
3. Bedrock client — free-form Converse call + Karpathy ingest prompt builder
4. Ingest orchestration — single-source flow wiring (context → Bedrock → parse → write → update)
5. Lambda handler — batch processing with timeout safety and per-file job state updates
6. CDK stack — gut existing, replace with Lambda + IAM role only
7. Vercel routes — start/status/cancel + manifest-based pending detection in /api/raw
8. UI — polling-based progress in upload modal Pending tab
9. Deploy — CDK deploy, Vercel env vars, IAM permission for lambda:InvokeFunction

**Key files:**
- NEW: `infra/lambda/curate/` (Lambda package)
- REPLACE: `infra-cdk/lib/infra-cdk-stack.ts` (Lambda-only CDK)
- MODIFY: `web/app/api/curate/` (start/status/cancel routes)
- MODIFY: `web/app/api/raw/route.ts` (manifest-based pending)
- MODIFY: `web/components/upload-modal.tsx` (polling UI)
- REMOVE: `web/lib/ingest/` (replaced by Lambda)