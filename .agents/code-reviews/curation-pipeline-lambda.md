# Code Review: Curation Pipeline (Lambda Ingest)

**Date:** 2026-05-16
**Branch:** preview
**Scope:** Lambda-based Karpathy-style curation pipeline replacing inline Vercel processing

**Stats:**

- Files Modified: 6
- Files Added: 18
- Files Deleted: 4
- New lines: ~7175
- Deleted lines: ~325

---

## Issues

```
severity: high
file: infra/lambda/curate/ingest.ts
line: 25-31
issue: Sequential S3 reads for page summaries — N+1 pattern with up to 50 GetObject calls
detail: The loop reads up to 50 pages sequentially to build summaries. In a mature wiki with many pages, this adds 5-15 seconds of latency per source file. Each GetObject is ~50-100ms.
suggestion: Use Promise.all with a concurrency limiter (e.g., batches of 10) to parallelize the reads. Alternatively, store summaries in the space index.md itself so only one read is needed.
```

```
severity: high
file: infra/lambda/curate/index.ts
line: 12-13
issue: Race condition on job state — read-then-update without locking
detail: The handler reads job state, then updates it. If the cancel route writes 'cancelled' between the getJob and updateJob calls on line 30-33, the updateJob will overwrite the cancellation with the 'processing' file status. The spread `{ ...current, ...patch }` in updateJob means the patch wins.
suggestion: In updateJob, after merging, check if current.status === 'cancelled' and preserve it (don't overwrite status unless the patch explicitly sets it). Or check cancellation again after getJob in the update path.
```

```
severity: high
file: web/app/api/curate/route.ts
line: 15-23
issue: Self-fetch in a Vercel serverless function may fail or cause cold-start loops
detail: The legacy route uses `fetch(startUrl.toString())` to call another route handler in the same deployment. On Vercel, this creates a new HTTP request to the same function, which may hit cold starts, count against concurrency limits, or fail if the URL resolution is wrong (e.g., behind a CDN or custom domain). Next.js Route Handlers should call shared logic directly, not self-fetch.
suggestion: Extract the start logic into a shared function (e.g., `lib/curate-start.ts`) and call it from both routes. Or simply remove this legacy route since the UI now calls /api/curate/start directly.
```

```
severity: medium
file: web/app/api/curate/start/route.ts
line: 6
issue: Non-null assertion on VAULT_BUCKET without runtime guard
detail: `const BUCKET = process.env.VAULT_BUCKET!` will be undefined at runtime if the env var is missing, causing cryptic S3 errors downstream. LAMBDA_ARN has a proper guard on line 19, but BUCKET does not.
suggestion: Add a guard: `if (!BUCKET) return NextResponse.json({ detail: 'VAULT_BUCKET not configured' }, { status: 500 });` or throw at module level like web/lib/s3.ts does.
```

```
severity: medium
file: web/components/upload-modal.tsx
line: 222-225 (cancelPending function)
issue: Cancel button only aborts the polling — does not actually cancel the Lambda job
detail: The `cancelPending` function aborts the AbortController (stopping the poll loop) and sets `pendingRunning = false`, but never calls `POST /api/curate/cancel` with the jobId. The Lambda continues processing in the background. The jobId is scoped inside the `startPendingStream` closure and not accessible to `cancelPending`.
suggestion: Store jobId in a ref (e.g., `jobIdRef.current = jobId`) after the start call succeeds, then in `cancelPending`, call `fetch('/api/curate/cancel', { method: 'POST', body: JSON.stringify({ jobId: jobIdRef.current }) })` before aborting.
```

```
severity: medium
file: infra/lambda/curate/ingest.ts
line: 28
issue: First-line extraction skips frontmatter incorrectly
detail: The logic `content.split('\n').find(l => l.trim() && !l.startsWith('---') && !l.startsWith('title:'))` will skip the `---` delimiters but not other frontmatter fields (tags, type, sources, etc.). It may return a frontmatter value like `type: source` as the "first line" summary.
suggestion: Parse past the frontmatter block properly: find the second `---` line, then take the first non-empty line after it.
```

```
severity: medium
file: infra/lambda/curate/job.ts
line: 18-22
issue: Read-modify-write on job state without concurrency protection
detail: `updateJob` does getJob → merge → putJson. If two concurrent calls to updateJob happen (unlikely in single-threaded Lambda but possible if the cancel route writes simultaneously), one write will be lost.
suggestion: Use S3 conditional writes (If-None-Match or versioning) for the job file, or accept this as a known limitation documented in the code. For the cancel case specifically, the Lambda should check cancellation status fresh before each file (which it does on line 12-13).
```

```
severity: low
file: infra/lambda/curate/parse.ts
line: 3
issue: Regex uses global flag with exec() — stateful regex may cause issues if reused
detail: `FILE_BLOCK_RE` has the `g` flag and is module-level. `exec()` with a global regex maintains `lastIndex` state. If `parseFileBlocks` is called multiple times in the same Lambda invocation (which it is — once per file in the batch), the regex state carries over.
suggestion: Reset `FILE_BLOCK_RE.lastIndex = 0` at the start of `parseFileBlocks`, or create the regex inside the function.
```

```
severity: low
file: web/app/api/curate/start/route.ts
line: 47
issue: Pending detection only checks key existence, not hash — re-processing requires manual manifest edit
detail: The comment says "full hash comparison happens in Lambda" but the Lambda's processSource doesn't actually compare hashes before processing — it always processes and then writes the hash. So modified files (same key, different content) will never be re-processed unless manually removed from the manifest.
suggestion: Either implement hash comparison in the Lambda (read content, compute hash, compare with manifest, skip if unchanged), or document this as intentional behavior (re-processing requires removing the entry from _processed.json).
```

```
severity: low
file: infra/lambda/curate/s3.ts
line: 39
issue: putObject always sets ContentType to text/markdown even for non-.md files
detail: The function is used to write all output files from the LLM, which includes `overview.md`, `log.md`, and `index.md`. This is fine for .md files, but if the LLM ever outputs a non-markdown file (unlikely but possible per spec's "LLM may create other folders"), the content type would be wrong.
suggestion: Minor — accept as-is since all outputs are markdown per the prompt contract.
```
