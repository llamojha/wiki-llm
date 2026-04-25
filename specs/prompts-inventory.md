# System Prompts Inventory

All LLM calls go through `web/lib/ingest/bedrock.ts` → Bedrock Converse API with tool_use.

**Model:** `eu.amazon.nova-2-lite-v1:0` (env: `INGEST_MODEL`)  
**Region:** `eu-central-1` (env: `BEDROCK_REGION`)

---

## 1. Space Assignment

| | |
|---|---|
| **File** | `web/lib/ingest/run.ts` (lines 28-42) |
| **Also at** | `web/app/api/curate/assign/route.ts` (lines 39-47) |
| **Purpose** | Assigns a root-level raw file to an existing or new space based on content |
| **Tool** | `assign_space` → returns `{ space, reason }` |
| **Input** | List of existing spaces + document filename + first 500 chars of content |
| **Output** | Space name (lowercase, a-z0-9, hyphens) |
| **When called** | Only for files in root `raw/` with no space prefix |

---

## 2. Page Planning

| | |
|---|---|
| **File** | `web/lib/ingest/plan.ts` (lines 16-78) |
| **Also at** | `web/app/api/curate/plan/route.ts` |
| **Purpose** | Analyzes a source document and plans which wiki pages to create/update |
| **Tool** | `submit_plan` → returns `{ pages: [{ path, type, title, description, action }] }` |
| **Input** | Source content + current space index + raw key + space name |
| **Output** | List of page plans (source, entity, concept types) with relative paths |
| **When called** | Once per raw file during curation |

**Prompt summary:** Decides how many pages to create (1 source page + 0-N entity/concept pages), their paths within the space, and whether to create or update.

---

## 3. Page Generation

| | |
|---|---|
| **File** | `web/lib/ingest/generate.ts` (lines 33-88) |
| **Also at** | `web/app/api/curate/generate/route.ts` |
| **Purpose** | Generates the actual Markdown content for a single wiki page |
| **Tool** | `submit_page` → returns `{ title, tags, body }` |
| **Input** | Source content + page plan entry + existing page content (if updating) |
| **Output** | Full Markdown body (frontmatter added programmatically) |
| **When called** | Once per page in the plan (3 concurrent) |

**Prompt variants by page type:**
- `source` → "a structured summary page that captures the key information from the source document"
- `entity` → "a wiki page about a specific person, organization, product, or service"
- `concept` → "a wiki page explaining a key idea, framework, or technical concept"

---

## Summary

| # | Prompt | Location | Purpose | Calls per file |
|---|---|---|---|---|
| 1 | Space Assignment | `run.ts` / `assign/route.ts` | Pick which space a file belongs to | 0-1 |
| 2 | Page Planning | `plan.ts` / `plan/route.ts` | Decide what pages to create | 1 |
| 3 | Page Generation | `generate.ts` / `generate/route.ts` | Write each page's content | 1-5 |

**Total Bedrock calls per raw file:** 2-7 (1 optional assign + 1 plan + 1-5 generates)

---

## Notes

- All prompts use tool_use (structured JSON output) rather than free-text parsing
- Frontmatter is added programmatically after generation, not by the LLM
- The spec (`specs/curation-pipeline.md`) proposes replacing all of the above with a **single Karpathy-style call** that outputs all files at once using `<file path="...">` XML blocks — eliminating the multi-step approach entirely
