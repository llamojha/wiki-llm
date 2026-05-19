# Feature: Phase 5 — Ask-Wiki Agent

The following plan should be complete, but it's important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files — the codebase has converged on specific helpers (`@/lib/scope`, `@/lib/search`, `@/lib/s3`, `@/lib/vault-paths`, `@/lib/index-gen`, `@/lib/log-append`) and the Bedrock client lives Lambda-side today; Phase 5 introduces it web-side.

## ⚠️ Read the design first

This plan is the implementation companion to **`specs/phase-5-ask-wiki-agent.md`**, which is the canonical design. Read the spec's **Design Details** section before starting any task — it covers:

- Hybrid query flow (index in system prompt + `search_vault` as fallback)
- User-configurable scope selector (`shared` / `user` / `both`, default `both`)
- Two generation paths: implicit `propose_page` (preview inline) and post-hoc Save-as-page (pre-fills the existing Editor)
- Empty-source generation: refuse first, client-side "Draft anyway" button issues a flagged re-ask
- Citations derived deterministically from `read_document` calls, not from text parsing
- NDJSON event envelope: `text` | `tool_use` | `tool_result` | `cite` | `propose_page` | `refuse` | `done` | `error`

### Design updates that supersede the tasks below

After the initial plan was written, the design was firmed up via product-design Q&A (recorded in `specs/phase-5-ask-wiki-agent.md`). The deltas:

1. **Chat scope selector** — Task 7 must include a scope toggle (`shared` / `user` / `both`) in the chat context bar. State lives on the chat panel; sent on every `/api/chat` request and on the `POST /api/docs` save.
2. **Refuse event** — Task 4 (`runAgent`) and Task 6 (route) must support a `{ type: 'refuse', reason, canForce: true }` event for empty-source cases. Task 7 must render a **Draft anyway (no sources)** button when `canForce` is true.
3. **`forceUnsourcedGeneration` flag** — Task 6 must accept it in the request body and Task 4 must thread it into the agent: when true, the agent skips `search_vault`, generates from prior knowledge, and emits a `propose_page` whose `body` starts with `_No vault sources — drafted from general knowledge._`.
4. **Post-hoc Save** — Task 7's Save-as-page path opens the **existing Editor pre-filled** with the answer text + a Citations section. It does NOT POST `/api/docs` directly. The Editor's existing save flow (Phase 4) does that.
5. **Catalog for `both` scope** — Task 6 reads `_system/index.md` for the active scope. For `both`, concatenate the shared master index and the user's master index, with a section header marking which is which. Task 3 (`buildSystemPrompt`) accepts a `catalog: string` rather than a single `indexMarkdown`.
6. **Acceptance criteria** — see the spec's full 16-item list. Several added or sharpened.

## Feature Description

A Bedrock-powered conversational agent embedded in the existing chat panel that answers questions grounded in the user's vault content, with citations, with refusal on no-hits, and with user-confirmed page creation. Replaces the current canned-reply mock in `web/components/chat-panel.tsx`.

The agent reads `_system/index.md` for catalog context, uses three tools (`search_vault`, `read_document`, `propose_page`) implemented as direct in-process function calls (no HTTP round-trips), streams its response token-by-token via NDJSON, and emits citations derived from `read_document` calls.

## User Story

As a Vaultmark user
I want to ask questions in plain language and get answers grounded in my own documents with citations
So that I can find and synthesize information across my vault without manually navigating files, and so I can optionally save the agent's answer as a new page in my personal wiki.

## Problem Statement

The chat panel UI was ported from the prototype with canned regex-matched replies. Users can type a question, but the response is a hard-coded stub — there's no real LLM integration, no vault grounding, no citations, no refusal behavior. The agent UX is the headline MVP 2 feature and the only piece left before Vaultmark is functionally complete as a personal knowledge assistant.

## Solution Statement

Implement a streaming `POST /api/chat` Route Handler in Next.js that drives a Bedrock Nova 2 Lite Converse-API tool-use loop. The loop:

1. Loads `_system/index.md` (scope-aware) and seeds the system prompt with that catalog.
2. Issues `ConverseStreamCommand` with three tools registered.
3. Streams text deltas to the client as NDJSON `{type: "text", delta}` events.
4. When the model emits a tool use, the route handler dispatches to the in-process tool implementation, appends a `tool_result` message, and continues the loop.
5. Tracks which doc IDs were read via `read_document`; emits a `{type: "cite", ...}` event for each.
6. If the model invokes `propose_page`, emits a `{type: "propose_page", slug, title, body}` event; the client renders a preview with a Save button that POSTs to the existing `/api/docs` route.
7. Logs each interaction to `_system/usage-log.jsonl` (scope-aware, append-only) for analytics.

The chat panel is rewired: send button POSTs the user message, the response is consumed as an NDJSON stream, text deltas accumulate into the assistant bubble, citations attach as they arrive, the propose-page preview renders inline.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**:
- `web/app/api/chat/` (new route, streaming)
- `web/lib/agent.ts` (new — agent loop)
- `web/lib/agent-tools.ts` (new — tool implementations)
- `web/lib/bedrock.ts` (new — web-side Bedrock client wrapper)
- `web/components/chat-panel.tsx` (rewire from mock to real stream)
- `web/lib/canned-replies.tsx` (delete after migration; keep `SUGGESTIONS`)

**Dependencies**:
- `@aws-sdk/client-bedrock-runtime` (already installed at `^3.1041.0` in `web/package.json:12`)
- Existing primitives: `@/lib/scope`, `@/lib/search`, `@/lib/s3`, `@/lib/vault-paths`, `@/lib/log-append`
- IAM permission: web runtime needs `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the configured model. Today the Lambda has these via CDK; the web runtime (Vercel or container) needs them too via its execution role / AWS credentials.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING

- `web/components/chat-panel.tsx` (whole file) — Why: This is the component you're rewiring. The send/receive lifecycle, message shape, citation rendering, `wikillm:ask` event listener, and `onSavePage` callback all stay; only the body of `send()` changes.
- `web/lib/canned-replies.tsx` (whole file) — Why: Reference for the `Cite` shape the chat panel renders, and for `SUGGESTIONS` which the new code reuses verbatim. After migration, only `SUGGESTIONS` survives.
- `web/lib/types.ts` (lines 32-36, 38-87) — Why: `Cite`, `Doc`, `GeneratedDoc`, `LiveDoc` types. The chat panel's `onSavePage` callback takes `GeneratedDoc`, so the new agent flow must preserve that contract.
- `web/components/app-shell.tsx` (lines 280-290, 369-376) — Why: How `ChatPanel` is mounted, what `handleSaveFromChat` does (currently in-memory only; you'll wire it to `POST /api/docs`).
- `infra/lambda/curate/bedrock.ts` (whole file) — Why: Reference implementation of the non-streaming Converse pattern. Mirror the client construction, region/model env var conventions, and error handling. Phase 5 uses `ConverseStreamCommand` + `toolConfig` instead, but the scaffolding is the same.
- `web/lib/search.ts` (whole file) — Why: `search()` and `SearchResult` are what `search_vault` wraps. Note `invalidateSearchIndex()` exists and is already called on writes; the agent doesn't need to invalidate.
- `web/lib/s3.ts` (lines 78-83) — Why: `getObject(relKey)` is what `read_document` wraps. Use the relative-key version, not the full-key one.
- `web/lib/scope.ts` (whole file) — Why: `Scope`, `ScopePaths`, `resolveScope()`. The agent's tools accept a `scope` parameter that flows through; index.md and search results both have a scope dimension.
- `web/lib/vault-paths.ts` (lines 50-52, 70-74) — Why: `systemKey('index.md')` resolves to the shared master index; `inferScopeFromKey` is useful when deriving cite metadata.
- `web/app/api/reindex/route.ts` (whole file) — Why: Reference for an NDJSON streaming route in this codebase. Uses `ReadableStream`, encodes events with `\n` separators, returns `application/x-ndjson` content type. The chat route follows the exact same envelope pattern.
- `web/app/api/docs/route.ts` (whole file) — Why: The chat panel's "Save as page" Save button POSTs here. Note the slug-collision 409 behavior — the chat UI must surface `data.detail` like the editor does (`editor.tsx:handleSave` is the precedent).
- `web/lib/log-append.ts` (whole file) — Why: Append-log pattern for `_system/log.md`. The new usage-log follows the same shape but to `_system/usage-log.jsonl` (one JSON line per event, not a Markdown bullet).
- `web/components/upload-modal.tsx` (lines 226-272, 336-353) — Why: Reference implementation of consuming an NDJSON stream via `ReadableStream.getReader()` + `TextDecoder` + buffer split. The chat panel uses the identical pattern.
- `infra/lambda/curate/index.ts` (lines 17-30) — Why: `createWriteQueue()` pattern for serializing async writes — same shape if you need to serialize the usage-log appends, though for a single-user MVP a simple await chain is fine.
- `web/lib/scope.ts::inferScopeFromKey` (lines 78-86) — Why: Used by the agent's citation builder when a `read_document` call returns a key — gives you the scope/userId for free.

### New Files to Create

- `web/lib/bedrock.ts` — Web-side Bedrock client + streaming converse wrapper. Mirrors `infra/lambda/curate/bedrock.ts` but exposes `converseStream(opts)` returning an async iterable of `ConverseStreamOutput` events.
- `web/lib/agent-tools.ts` — The three tool implementations: `searchVault`, `readDocument`, `proposePage`. Each is a plain async function the agent loop calls directly (no HTTP).
- `web/lib/agent.ts` — `runAgent(opts)` function: takes user message + chat history + scope, drives the converse-stream loop, yields envelope events (text deltas, tool uses, cites, propose-page, done, error).
- `web/lib/agent-prompts.ts` — System prompt construction. Reads `_system/index.md` (scope-aware), composes a system message that establishes role, refusal policy, tool-use protocol, and citation requirements.
- `web/lib/usage-log.ts` — Append-only JSONL logger to `_system/usage-log.jsonl` (scope-aware).
- `web/app/api/chat/route.ts` — `POST` handler. Validates body, resolves scope, calls `runAgent`, returns `Response(ReadableStream)` with NDJSON content type.
- `specs/phase-5-ask-wiki-agent.md` — already exists; add an "Implementation notes" section after the work completes.

### Relevant Documentation — YOU SHOULD READ THESE BEFORE IMPLEMENTING

- [AWS SDK for JavaScript v3 — BedrockRuntimeClient `ConverseStreamCommand`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-runtime/command/ConverseStreamCommand/)
  - Section: input shape (`modelId`, `messages`, `system`, `toolConfig`, `inferenceConfig`) and the `stream` output as `AsyncIterable<ConverseStreamOutput>`.
  - Why: This is the primary new API surface. The Lambda's `ConverseCommand` doesn't stream and doesn't use tools — neither pattern transfers directly.
- [Amazon Bedrock Converse API tool use](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference-tools.html)
  - Section: "Tool use" — explains the `toolUseId` correlation, the `tool_use` content block, the `tool_result` content block, and the multi-turn loop until `stopReason === 'end_turn'`.
  - Why: The agent loop's correctness depends on respecting the toolUseId correlation and the stopReason check.
- [Amazon Nova Lite — supported features](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-nova.html)
  - Section: tool use, streaming, context window.
  - Why: Confirms Nova Lite supports `ConverseStream` + tool use. Cross-region profile `us.amazon.nova-2-lite-v1:0` is the safe ID when the home region requires it (CLAUDE.md notes this).
- [MDN — Streams API and ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)
  - Section: server-side stream construction with `new ReadableStream({ start })`.
  - Why: The chat route returns one. Look at `web/app/api/reindex/route.ts` for the exact codebase pattern.

### Patterns to Follow

Specific patterns extracted from the codebase. Use these verbatim; do not invent new ones.

**Naming conventions:**

- Files: kebab-case (`agent.ts`, `agent-tools.ts`, `bedrock.ts`).
- React components: PascalCase (`ChatPanel` stays).
- Functions: camelCase (`runAgent`, `searchVault`, `readDocument`).
- Types: PascalCase (`AgentEvent`, `AgentTool`, `ToolResult`).
- Route segments: kebab-case (`/api/chat`).

**Streaming NDJSON envelope** (mirrors `web/app/api/reindex/route.ts:39-44, 75, 84`):

```ts
const encoder = new TextEncoder();
const stream = new ReadableStream({
  async start(controller) {
    const send = (obj: Record<string, unknown>) => {
      controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
    };
    try {
      send({ type: 'start', ... });
      // ... agent loop ...
      send({ type: 'done', ... });
    } catch (err) {
      send({ type: 'error', detail: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      controller.close();
    }
  },
});
return new Response(stream, {
  headers: { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' },
});
```

**NDJSON consumption on the client** (mirrors `web/components/upload-modal.tsx:336-352`):

```ts
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop()!;
  for (const line of lines) {
    if (!line) continue;
    const msg = JSON.parse(line);
    // dispatch by msg.type
  }
}
```

**Bedrock client construction + env vars** (mirrors `infra/lambda/curate/bedrock.ts:9-17`):

```ts
const MODEL_ID = process.env.BEDROCK_MODEL ?? 'eu.amazon.nova-2-lite-v1:0';
const region = process.env.BEDROCK_REGION ?? 'eu-central-1';

let _client: BedrockRuntimeClient | null = null;
function client(): BedrockRuntimeClient {
  if (!_client) _client = new BedrockRuntimeClient({ region });
  return _client;
}
```

**Error responses on routes** (mirrors all routes under `web/app/api/`):

```ts
return NextResponse.json({ detail: 'jobId is required' }, { status: 400 });
```

**Scope plumbing** (mirrors `web/app/api/curate/start/route.ts:30-43, 109-113`):

```ts
const body = await req.json().catch(() => ({}));
const { scope: scopeName, userId } = body as { scope?: Scope; userId?: string; ... };
const scope = resolveScope({ scope: scopeName ?? 'shared', userId });
// ... use scope.systemKey('index.md'), scope.generatedPrefix(s), etc.
```

**Append log to `_system/`** (mirrors `web/lib/log-append.ts`):

```ts
const key = scope.systemKey('usage-log.jsonl');
let existing = '';
try { existing = await getObject(key); } catch { /* fresh */ }
const line = JSON.stringify({ ts: new Date().toISOString(), ... });
const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
await putObject(key, content);
```

**Citation type** (from `web/lib/types.ts:32-36`):

```ts
export type Cite = {
  id?: string;     // S3 relative key — used by ChatPanel to navigate via onOpenDoc
  title: string;   // From frontmatter or filename stem
  section: string; // First heading the answer drew from, or '§ source'
};
```

**Tool dispatch (anti-pattern to avoid):** Do NOT wrap the tools in HTTP routes. The agent runs server-side in the same Node process as `lib/search.ts` and `lib/s3.ts`. Calling them as functions is correct. The Phase 5 spec is explicit: *"Tools are direct function calls — no HTTP, no separate service."*

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Build the primitive types and the web-side Bedrock wrapper. No agent logic yet.

**Tasks:**

- Define the agent event envelope union type (one shape, many `type` discriminators).
- Define the tool spec, tool input/output types.
- Implement `web/lib/bedrock.ts` — `converseStream(opts)` returning the SDK's async iterable.
- Implement `web/lib/usage-log.ts` — append-only JSONL writer scoped to a vault scope.

### Phase 2: Tools

Three pure async functions. Each takes its specific input + scope and returns its specific output. No streaming, no model interaction. Easily testable in isolation.

**Tasks:**

- `searchVault(query, scope, options?)` — wraps `lib/search.ts::search()`, filters by scope prefix.
- `readDocument(docId)` — wraps `lib/s3.ts::getObject()` + `gray-matter` for frontmatter + first-heading extraction.
- `proposePage(slug, title, body)` — does NOT write. Returns a structured preview the route handler emits as an event. Pure passthrough.

### Phase 3: Agent loop

The core: drive the converse-stream loop with tool-use handling. Yields envelope events.

**Tasks:**

- Build the system prompt (loads `index.md` for the scope, embeds tool-use protocol + refusal policy + citation requirements).
- Implement `runAgent(opts)` as an async generator yielding envelope events.
- Loop body: send messages → consume `ConverseStreamOutput` events → for each text block delta yield `{type:'text', delta}` → on tool-use start collect input → on stop reason `tool_use` execute tool → append `tool_result` message → repeat. On `end_turn`, emit accumulated citations + `done`.
- Emit `{type:'cite', ...}` for each distinct doc the agent read.
- Emit `{type:'propose_page', ...}` if `proposePage` was called.
- Cap iterations (e.g. 6 tool-use rounds) to avoid runaway loops.

### Phase 4: Route handler

Thin wrapper: validate, resolve scope, run the agent, marshal events into NDJSON, log usage.

**Tasks:**

- `POST /api/chat` body shape: `{ message: string, history?: Message[], scope?, userId?, contextDocId? }`.
- Resolve scope. Read `_system/index.md` (best effort — fall back to empty catalog).
- Drive `runAgent` and forward each yielded event to the NDJSON stream.
- After `done`, append a usage-log entry.

### Phase 5: UI rewire

Replace canned reply with real stream consumer. Preserve all existing UX.

**Tasks:**

- Rewrite `chat-panel.tsx::send()` to POST `/api/chat` and consume NDJSON.
- Accumulate text deltas into the assistant bubble live.
- Track citations as they arrive; render in the existing citation bar.
- If a `propose_page` event arrives, render a preview block with "Save as page" → POST `/api/docs` → on success `onOpenDoc(id)`.
- Drop `CANNED_REPLIES` import, keep `SUGGESTIONS`.

### Phase 6: Tests + smoke

**Tasks:**

- Pure-function unit tests for `searchVault`, `readDocument` (mocked S3/search), and `proposePage`.
- Mock Bedrock for an integration test of the agent loop's tool-use dispatch (no live model calls in tests).
- Manual smoke checklist (see Validation Commands Level 4).

---

## STEP-BY-STEP TASKS

> **Note**: this section was rewritten to reflect the locked design (`specs/phase-5-ask-wiki-agent.md`). The numbering below supersedes any prior task list in this document.

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable. Validation commands assume cwd is `web/` unless noted.

### Task ordering rationale

The tasks form a layered dependency chain. Each task adds one observable capability:

```
Foundation
  1. Bedrock streaming wrapper       (no agent yet — just streams text)
  2. Tool implementations            (search/read/propose work standalone)
  3. System prompt builder           (catalog assembly)

Core agent
  4. Agent loop                      (drives the converse-stream + tool loop)
  5. Usage logging                   (best-effort, off the hot path)
  6. /api/chat route                 (NDJSON envelope, scope handling)

UI surface
  7. Chat panel — stream consumer    (text deltas + citations live)
  8. Chat panel — scope selector     (user-configurable shared/user/both)
  9. Chat panel — propose_page UI    (inline preview + Save/Discard)
  10. Chat panel — refuse + force    (Draft anyway button)
  11. Chat panel — post-hoc save     (every answer → Editor pre-filled)

Closeout
  12. Cleanup + wire app-shell + smoke + ROADMAP + verify
```

Each task corresponds to a single TaskCreate entry. The acceptance check at the end of each is a one-line manual verification that the new capability works end-to-end.

### Task 1 — CREATE `web/lib/bedrock.ts`

- **IMPLEMENT**: Web-side Bedrock client wrapper. Export `converseStream(opts: ConverseStreamInput): Promise<AsyncIterable<ConverseStreamOutput>>`. Reuse a memoized `BedrockRuntimeClient`. Read `BEDROCK_MODEL` and `BEDROCK_REGION` env vars with the same defaults as the Lambda.
- **PATTERN**: Mirror `infra/lambda/curate/bedrock.ts:9-17` for client setup. Use `ConverseStreamCommand` instead of `ConverseCommand`. Return `res.stream` (the SDK exposes it as `AsyncIterable`).
- **IMPORTS**: `BedrockRuntimeClient`, `ConverseStreamCommand`, and the request/response types from `@aws-sdk/client-bedrock-runtime`.
- **GOTCHA**: `ConverseStreamCommandOutput.stream` can be `undefined` if the API call fails before streaming starts. Throw a clear error in that case rather than returning undefined downstream.
- **VALIDATE**: `pnpm typecheck` passes.

### Task 2 — CREATE `web/lib/agent-tools.ts`

- **IMPLEMENT**:
  - `export type AgentToolName = 'search_vault' | 'read_document' | 'propose_page';`
  - `export const TOOL_SPECS` — array of Bedrock `Tool` objects with name, description, and JSON schema for input. The model uses these to decide when/how to call.
  - `searchVault({ query, scope?, limit? })`: calls `search(query, limit ?? 8)` from `@/lib/search`, then filters results to those whose `id` starts with the scope's `generatedPrefix` / `authoredPrefix` / `rawPrefix` (use `inferScopeFromKey` for filtering). Returns `Array<{ id, title, path, snippet, rank }>`.
  - `readDocument({ docId })`: `await getObject(docId)`. Parse frontmatter with `gray-matter`. Extract the first heading (`# ...`) for the `section` field. Return `{ id, title, section, body, scope }` where `scope` is `inferScopeFromKey(docId).scope`.
  - `proposePage({ slug, title, body, scope?, userId? })`: does NOT write. Returns `{ slug, title, body, scope: scope ?? 'user', userId }`. The route handler emits this as a `{type:'propose_page'}` event.
- **PATTERN**: `web/lib/search.ts::search` for the search wrapper. `web/lib/s3.ts::getObject` for the read wrapper. `web/lib/scope.ts::inferScopeFromKey` for scope filtering.
- **IMPORTS**: `import { search } from '@/lib/search'; import { getObject } from '@/lib/s3'; import matter from 'gray-matter'; import { inferScopeFromKey, type ScopePaths } from '@/lib/scope'; import type { Tool } from '@aws-sdk/client-bedrock-runtime';`
- **GOTCHA**: Bedrock `Tool.toolSpec.inputSchema` shape is `{ json: <JSONSchema7> }` — wrap your JSON schema in a `{ json: ... }` envelope, not the raw schema.
- **GOTCHA**: `gray-matter` extracts frontmatter; the `title` field may be absent — fall back to `keyToTitle(docId)` (mirror `web/lib/search.ts::keyToTitle` logic locally).
- **VALIDATE**: `pnpm typecheck` passes.

### Task 3 — CREATE `web/lib/agent-prompts.ts`

- **IMPLEMENT**:
  - `buildSystemPrompt(opts: { indexMarkdown: string; scope: Scope; contextDocTitle?: string }): string` — returns a single string covering:
    1. Role: "You are Vaultmark's wiki assistant. Answer questions grounded in the user's own documents."
    2. Tool-use protocol: "You have three tools — `search_vault`, `read_document`, `propose_page`. Use `search_vault` to find candidate docs by query. Use `read_document` to read a doc's content before quoting it. Only call `propose_page` when the user explicitly asks you to generate a new page or save the answer."
    3. Refusal policy: "If you cannot find relevant content after at least one search call, say so explicitly and do not invent answers."
    4. Citation requirement: "Every factual claim must be tied to a doc you read via `read_document`. If you did not read a doc, do not cite it."
    5. Catalog: append the contents of `index.md` (truncate to ~30k chars if larger).
- **PATTERN**: The Lambda's `infra/lambda/curate/prompt.ts` is the closest precedent for building a system prompt with embedded structure.
- **IMPORTS**: `import type { Scope } from '@/lib/types';`
- **GOTCHA**: Nova Lite has a 1M-token context window. Don't truncate aggressively unless `index.md` is over a few hundred KB.
- **VALIDATE**: `pnpm typecheck` passes.

### Task 4 — CREATE `web/lib/agent.ts`

- **IMPLEMENT**:
  - Define the event union type:
    ```ts
    export type AgentEvent =
      | { type: 'text'; delta: string }
      | { type: 'tool_use'; name: AgentToolName; input: unknown }
      | { type: 'tool_result'; name: AgentToolName; ok: boolean }
      | { type: 'cite'; id: string; title: string; section: string }
      | { type: 'propose_page'; slug: string; title: string; body: string; scope: Scope; userId?: string }
      | { type: 'done'; tokensUsed?: number }
      | { type: 'error'; detail: string };
    ```
  - `export async function* runAgent(opts: { message: string; history?: BedrockMessage[]; scope: ScopePaths; contextDocId?: string }): AsyncGenerator<AgentEvent>`:
    1. Read `index.md` via `getObject(opts.scope.systemKey('index.md'))` — catch `NoSuchKey` and use `''`.
    2. Build system prompt via `buildSystemPrompt({ indexMarkdown, scope: opts.scope.scope })`.
    3. Compose `messages = [...history, { role: 'user', content: [{ text: opts.message }] }]`.
    4. Loop (max 6 rounds):
       - Call `converseStream({ modelId, system, messages, toolConfig: { tools: TOOL_SPECS }, inferenceConfig: { maxTokens: 4096 } })`.
       - Consume the async iterable. For each event:
         - `contentBlockDelta.delta.text` → yield `{ type: 'text', delta }`.
         - `contentBlockStart.start.toolUse` → start accumulating tool input.
         - `contentBlockDelta.delta.toolUse.input` → accumulate JSON chunks.
         - `messageStop.stopReason` → check. If `tool_use`, dispatch each pending tool, append the assistant message + a `user` `tool_result` message, break the inner consumption loop and resume the outer loop with the new messages. If `end_turn`, emit `cite` events for every unique `read_document` id collected this turn, then yield `done` and return.
       - On tool dispatch:
         - `search_vault` → `searchVault(input)`, yield `tool_use` + `tool_result`. Result goes into the `tool_result` content block.
         - `read_document` → `readDocument(input)`, record the id for citation, yield `tool_use` + `tool_result`. Body becomes the tool result.
         - `propose_page` → call `proposePage(input)`, yield `tool_use` + `propose_page` event. Tool result back to the model is `{ status: 'preview-shown', note: 'User will decide whether to save.' }`.
    5. If iteration cap is hit without `end_turn`, yield `{ type: 'error', detail: 'Agent exceeded max tool-use rounds' }`.
- **PATTERN**: The Bedrock SDK's `ConverseStreamCommandOutput.stream` is an `AsyncIterable<ConverseStreamOutput>` discriminated union with `messageStart | contentBlockStart | contentBlockDelta | contentBlockStop | messageStop | metadata`.
- **IMPORTS**: From `@aws-sdk/client-bedrock-runtime`: `Message`, `ContentBlock`, `ConverseStreamOutput`, `ToolUseBlock`, `ToolResultBlock`. From own modules: `converseStream`, `TOOL_SPECS`, `searchVault`, `readDocument`, `proposePage`, `buildSystemPrompt`, `getObject`.
- **GOTCHA**: `contentBlockDelta.delta.toolUse.input` arrives as a JSON string in chunks. Concatenate, then `JSON.parse` once `contentBlockStop` arrives for that block. Parsing partial chunks will throw.
- **GOTCHA**: The same `toolUseId` round-trips on the `tool_result`. Preserve it exactly.
- **GOTCHA**: For `propose_page`, the tool result sent back to Bedrock must NOT contain the body again — it's already in the user's view. Just confirm it was previewed.
- **VALIDATE**: `pnpm typecheck` passes.

### Task 5 — CREATE `web/lib/usage-log.ts`

- **IMPLEMENT**:
  - `export async function logChatInteraction(opts: { scope: ScopePaths; question: string; answerChars: number; citeCount: number; toolCalls: number; durationMs: number; error?: string }): Promise<void>`
  - Read `getObject(scope.systemKey('usage-log.jsonl'))`, append `JSON.stringify({ ts, ...opts.scope.scope, ...rest }) + '\n'`, write back.
- **PATTERN**: `web/lib/log-append.ts` is the read-modify-write template.
- **IMPORTS**: `import { getObject, putObject } from '@/lib/s3'; import type { ScopePaths } from '@/lib/scope';`
- **GOTCHA**: This is best-effort. Wrap the write in a `try/catch` and `console.warn` on failure — never let logging block the user response.
- **VALIDATE**: `pnpm typecheck` passes.

### Task 6 — CREATE `web/app/api/chat/route.ts`

- **IMPLEMENT**:
  - `POST` handler. Body: `{ message: string; history?: BedrockMessage[]; scope?: Scope; userId?: string; contextDocId?: string }`.
  - Validate `message` is a non-empty string.
  - Resolve scope.
  - Construct a `ReadableStream` whose `start(controller)` runs `runAgent(...)` and forwards each event via `controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))`.
  - On error, emit `{ type: 'error', detail }` and close. Don't throw out of the stream.
  - After the generator finishes (or errors), call `logChatInteraction` (fire-and-forget — don't await it inside the stream).
  - Return `new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' } })`.
- **PATTERN**: `web/app/api/reindex/route.ts:39-114` is the closest template.
- **IMPORTS**: `import { NextResponse } from 'next/server'; import { runAgent } from '@/lib/agent'; import { resolveScope, type Scope } from '@/lib/scope'; import { logChatInteraction } from '@/lib/usage-log';`
- **GOTCHA**: Vercel free tier has a 60s edge timeout. Long agent runs can exceed this. Either (a) accept the timeout for MVP, (b) cap `maxTokens` per turn and total turns to stay under the budget, or (c) deploy under a longer-budget runtime. For MVP, cap turns at 6 and `maxTokens: 4096` per turn — typically completes in <30s.
- **VALIDATE**: `pnpm typecheck` passes. `pnpm build` passes (catches route export shape mistakes).

### Task 7 — UPDATE `web/components/chat-panel.tsx`

- **REMOVE**: `import { CANNED_REPLIES, DEFAULT_REPLY, SUGGESTIONS }` → keep only `SUGGESTIONS`. Delete the `setTimeout(...)` mock branch in `send()`.
- **ADD**: A new `ProposePagePreview` block in `Message` shape (`{ slug, title, body }`), rendered inline when present with a "Save as page" button.
- **REWRITE `send()`**:
  1. Add user message to state.
  2. `fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message: text, scope: 'shared', /* TODO: thread real scope */ }) })`.
  3. Read NDJSON stream (use the same `getReader()` + `TextDecoder` pattern as `upload-modal.tsx:336-352`).
  4. On `{ type: 'text', delta }`: append delta to a buffer that backs the current assistant message's text.
  5. On `{ type: 'cite' }`: append to the message's `cites` array.
  6. On `{ type: 'propose_page' }`: attach as a preview to the message.
  7. On `{ type: 'done' }`: clear `thinking`, finalize.
  8. On `{ type: 'error' }`: surface as toast or inline error message.
- **REWRITE `saveAsPage(msg)`** to POST to `/api/docs` with `{ title, body }` derived from the proposal (not the freeform text). Surface 409s with `data.detail`. On success, call `onOpenDoc(newId)` and clear the proposal.
- **PATTERN**: `web/components/upload-modal.tsx::startPendingStream` — NDJSON stream consumption template.
- **PATTERN**: `web/components/editor.tsx::handleSave` — POST `/api/docs` + read `data.detail` on non-OK.
- **GOTCHA**: The assistant message renders ReactNode (`m.content`) today. The new code accumulates plain text from deltas; render it as a `<p>{text}</p>` (or split on `\n\n` for paragraphs). Don't try to render Markdown live mid-stream — buffer until `done`, then run through `renderMarkdown` (with `dangerouslySetInnerHTML` like DocReader does) for final rendering.
- **GOTCHA**: The chat scope today is hardcoded UI text ("shared + my wiki"). Wire it through props from `app-shell.tsx` later — for MVP, pass `scope: 'shared'` on every request unless `contextDoc` is set, in which case pass the doc's inferred scope.
- **VALIDATE**: `pnpm typecheck` passes. `pnpm build` passes.

### Task 8 — UPDATE `web/lib/canned-replies.tsx`

- **REMOVE**: `CANNED_REPLIES` and `DEFAULT_REPLY` (the entire mock-reply dataset).
- **KEEP**: `SUGGESTIONS` array (still used by the chat panel's empty state).
- **VALIDATE**: `grep -rn "CANNED_REPLIES\|DEFAULT_REPLY" web/` returns nothing.

### Task 9 — UPDATE `web/components/app-shell.tsx`

- **UPDATE `handleSaveFromChat`**: it currently shoves a `GeneratedDoc` into in-memory state. After Task 7, the chat panel's Save flow POSTs to `/api/docs` directly. Simplify `handleSaveFromChat` to just call `openDoc(newId)` after the page is created, and `getTree().then(setTree)` to refresh the sidebar.
- **OPTIONAL**: Pass the current sidebar `scope` into `ChatPanel` as a prop, so the chat agent knows whether to search shared or user content. For MVP this can stay hardcoded shared.
- **VALIDATE**: `pnpm typecheck` passes.

### Task 10 — CREATE smoke tests (no jest setup in web/ yet — defer; document manual checklist)

- **IMPLEMENT**: Add a `web/lib/__smoke__/agent.md` checklist file with five manual test scenarios:
  1. Simple question with a hit ("What's our auth strategy?") → agent searches, reads, answers with citations.
  2. Question with no hits ("Tell me about quantum dolphins") → agent searches, finds nothing, refuses clearly.
  3. Generate page request ("Write me a runbook for X") → agent emits `propose_page`, chat panel renders preview, Save → POST `/api/docs` → 201 → sidebar refreshes.
  4. Slug collision on Save → `/api/docs` 409 → toast surfaces "A page with slug ... already exists" → preview stays open for retitling.
  5. Cancellation: user closes chat panel mid-stream → fetch aborts, no orphan log entry.
- **PATTERN**: The Phase 3 work flagged "no runtime smoke test" as a contributing factor in the postmortem. Capture this list now to avoid the same gap.
- **VALIDATE**: Manual run-through of the checklist; document results in a session memory.

---

## TESTING STRATEGY

### Unit Tests

The web project does not currently have a jest/vitest setup. **Do not introduce one for this feature unless it's a separate prep task** — the Lambda has tests under `infra/lambda/curate/*.test.ts`, but `web/` relies on typecheck + build + manual smoke for verification.

If you want strict guard rails, prefer:
1. Pure helper functions colocated under `web/lib/__tests__/` using `pnpm test` (would require adding `vitest` — out of scope for this plan).
2. OR add small invariant assertions in development:
   - `agent-tools.ts::readDocument` — assert returned `body` is non-empty.
   - `agent-tools.ts::searchVault` — assert all returned IDs match scope's expected prefix when scope is provided.

### Integration Tests

Out of scope without a test runner. Smoke checklist (Task 10) is the substitute.

### Edge Cases

Document and verify manually:

- **Empty `index.md`** (new vault, no curation yet) — agent should still function but warn the user that the catalog is empty.
- **Agent never calls a tool** — direct answer from prior knowledge. Citations array is empty. UI shows a "no citations" footer rather than fabricating ones.
- **Agent calls `search_vault` but no `read_document`** — no citations even though search returned hits. Acceptable: the agent must `read_document` to cite.
- **Tool error** (e.g., `read_document` on missing key) — return `{ ok: false, error }` as tool result, agent recovers or refuses.
- **Stream interruption** (user closes panel) — client aborts fetch, server stream's `controller.close()` is called, no broken state.
- **Concurrent chat requests in the same browser tab** — second request races the first. Cancel the first via `AbortController`.
- **Bedrock throttle/quota** — surface as `{ type: 'error', detail: '...' }`. Don't crash the route.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
cd web && pnpm typecheck
```

(There is no separate ESLint step wired in CI today; `tsc --noEmit` is the gate.)

### Level 2: Build

```bash
cd web && pnpm build
```

Catches malformed route handler exports, missing imports, and runtime-incompatible code paths (e.g. node-only modules in client components).

### Level 3: Lambda regression (no Lambda changes expected, but the curate Lambda still uses the same Bedrock model id env var pattern — confirm nothing drifted)

```bash
cd infra/lambda/curate && npx tsc --noEmit && npm test
```

### Level 4: Manual Validation

Run `pnpm dev` and walk through the smoke checklist (Task 10). Verify in the Network panel:

- `POST /api/chat` returns `Content-Type: application/x-ndjson` and chunked encoding.
- Stream emits at least one `text` event before `done`.
- For questions that should hit the vault, at least one `cite` event arrives.
- For "write me a page" prompts, exactly one `propose_page` event arrives, followed by a Save button in the UI.
- Save button → `POST /api/docs` → 201 → sidebar refreshes → new doc opens.
- After successful chat: `s3://vaultmark/_system/usage-log.jsonl` has a new line.

### Level 5: Additional Validation (Optional)

Test against `users/<id>/_system/index.md` by setting the chat scope to user and confirming:
- The agent reads the user-scoped index, not the shared one.
- `propose_page` writes land under `users/<id>/authored/personal/<slug>.md` (the existing `/api/docs` POST hardcodes `personalPrefix()`).

---

## ACCEPTANCE CRITERIA

Mirrors `specs/phase-5-ask-wiki-agent.md` acceptance list. All must be met:

- [ ] `POST /api/chat` accepts a user message and streams a response via `ReadableStream`.
- [ ] The agent reads `index.md` as its catalog and uses tools to answer questions.
- [ ] Tool `search_vault(query, scope?)` searches via Fuse.js with scope support (all / folder / page-filter via prefix matching).
- [ ] Tool `read_document(doc_id)` retrieves full Markdown content from S3 via `lib/s3.ts`.
- [ ] Tool `propose_page(slug, title, body)` renders a preview in the chat UI; the page is only written to S3 after explicit user approval (Save button → `POST /api/docs`).
- [ ] The agent refuses to answer (with a clear message) when no relevant content is found.
- [ ] Citations in responses link to the source documents in the portal (`onOpenDoc(id)`).
- [ ] The agent only proposes new pages when the user explicitly asks for content generation.
- [ ] Bedrock model is `amazon.nova-2-lite-v1:0` (cross-region `us.amazon.nova-2-lite-v1:0` when needed) — controlled by `BEDROCK_MODEL` env var.
- [ ] Chat interactions are logged server-side to `_system/usage-log.jsonl`.
- [ ] `ChatPanel` mock (`CANNED_REPLIES`, `DEFAULT_REPLY`) is fully replaced with real agent interaction.

---

## COMPLETION CHECKLIST

- [ ] All 10 tasks completed in order
- [ ] Each task's `VALIDATE` step passed before proceeding
- [ ] Level 1–3 validation commands all green
- [ ] Manual smoke checklist (Task 10) walked through and recorded in session memory
- [ ] Acceptance criteria all met
- [ ] `specs/phase-5-ask-wiki-agent.md` annotated with an "Implementation notes" section describing drifts (mirror Phase 3/4 convention)
- [ ] `ROADMAP.md` Phase 5 section ticked and dated
- [ ] IAM/permissions verified: web runtime can `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the configured model

---

## NOTES

**On chat persistence (deferred per spec).** Chat history lives in browser memory only. `history?: BedrockMessage[]` is accepted in the route body so the client can replay context, but the server doesn't persist it. Persistence becomes a Phase 6 concern (RDS or chat-scoped S3 keys).

**On scope and the chat panel.** The MVP wires `scope: 'shared'` on every request unless the user has the sidebar set to `'user'`. A future improvement is to expose a per-message scope override ("ask my personal wiki vs the shared one"). The contract already carries it — the UI just doesn't surface it yet.

**On Vercel timeouts.** A 6-turn tool-use loop with Nova Lite typically completes in 15–30s, comfortably under the 60s edge limit. If a vault grows large enough that `read_document` reads big files and slows the loop, two mitigations:
1. Add a `maxBytesPerRead` cap to `readDocument` and truncate.
2. Move chat off the edge runtime by adding `export const runtime = 'nodejs'` in `web/app/api/chat/route.ts`. Vercel's serverless Node functions allow up to 300s on most plans.

**On `proposePage` and slug collisions.** The agent picks a slug from the title via `slugify`. If `POST /api/docs` 409s on collision, the chat panel keeps the proposal open and surfaces the server's `detail` — let the user rename and Save again. The mechanism is identical to the editor's create-new-page flow already shipped.

**On citation quality.** Bedrock's tool-use model is not perfect about always reading before citing. The system prompt explicitly forbids citing un-read docs. In practice, validate by checking the smoke test: if `read_document` was never called, the response shouldn't contain `[1]`, `[2]` markers. If it does, tighten the system prompt.

**On the in-memory search index.** `web/lib/search.ts` walks all S3 objects regardless of scope (see ROADMAP Phase 6 open gaps). The agent's `search_vault` therefore returns globally-indexed results, which `searchVault` then filters by scope prefix. Acceptable for single-user MVP; multi-tenant SaaS will need scope-isolated indexes (Phase 6).

**On the curate Lambda's manifest serialization fix.** Unrelated to Phase 5, but verify it's still working after this PR lands — the chat agent shares the `@/lib/s3` and `@/lib/search` helpers; no overlap, but a regression smoke test on curate doesn't hurt.

**Confidence score for one-pass success: 7/10.**

The codebase has all the primitives in place (scope, search, S3, log-append, NDJSON stream pattern, env-var-driven Bedrock model id) and the Phase 5 spec is unambiguous. The dominant risks are:

- **Bedrock tool-use streaming nuance** — the SDK's `ConverseStreamOutput` event sequence (delta accumulation, tool-input chunking, stop-reason handling) is the most error-prone part. Mitigation: test against the SDK type definitions, write the loop carefully, and lean on the documentation links above.
- **System prompt quality** — the agent's refusal and citation discipline depend entirely on the prompt. Expect 1–2 iterations after the first manual smoke test.
- **No automated tests** — typecheck + build + manual smoke is the only gate. A regression in the agent loop won't be caught by CI.

Tighten to 8/10 by adding a vitest harness for `agent-tools.ts` before starting; tighten to 9/10 by writing a Bedrock-mock integration test of `runAgent`.
