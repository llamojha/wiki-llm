# Plan 006: Stop coercing unparseable agent tool input to `{}`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/agent.ts tests/e2e/chat.spec.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

The ask-wiki agent streams tool-use input as JSON chunks from Bedrock. When
the joined chunks fail `JSON.parse` (truncated stream, model emitting a large
`propose_page` body that got cut off), the loop silently substitutes `{}` and
dispatches the tool anyway: `read_document` with no `doc_id` throws an opaque
"outside the active scope" error, `search_vault` searches for `undefined`,
`propose_page` proposes an empty page. The real cause (malformed input) is
invisible, and a round of the bounded agent loop is wasted.

## Current state

- `web/lib/agent.ts` — inside the streaming event loop, `contentBlockStop`
  finalizes a pending tool-use block:

  ```ts
  // web/lib/agent.ts:228-246
  const pending = pendingByIndex.get(idx);
  if (pending) {
    let parsedInput: unknown = {};
    const joined = pending.inputChunks.join('');
    if (joined.trim()) {
      try {
        parsedInput = JSON.parse(joined);
      } catch {
        parsedInput = {};
      }
    }
    assistantContent.push({
      toolUse: {
        toolUseId: pending.toolUseId,
        name: pending.name,
        input: parsedInput as DocumentType,
      },
    });
  }
  ```

- Later in the same generator, each `toolUse` block in `assistantContent` is
  dispatched (`web/lib/agent.ts:299-353`); tool failures are already handled
  by pushing a `toolResult` with `status: 'error'` and `content: [{ text: detail }]`
  back to the model, plus yielding `{ type: 'tool_result', ok: false, error }`
  to the client. That existing error path is the model to follow.
- An empty `joined` (no chunks at all) is legitimately `{}` — some tools could
  in principle take no arguments; keep that behavior.
- Note: the agent is an async generator yielding typed events
  (`tool_use`, `tool_result`, `error`, `done`, …) consumed by
  `web/app/api/chat/route.ts`; don't add new event types.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| E2E       | `pnpm build && pnpm test:e2e -- --grep chat` | all pass |

## Scope

**In scope**:
- `web/lib/agent.ts`

**Out of scope**:
- `web/lib/agent-tools.ts` — tool implementations are fine.
- `web/app/api/chat/route.ts` — no protocol change.
- New agent event types or client (chat-panel) changes.

## Git workflow

- Branch: `advisor/006-tool-input-parse-guard`
- Commit style: imperative, under 72 chars.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Track the parse failure on the pending block

In the `contentBlockStop` handler, distinguish "empty input" from "unparseable
input". Change the block to record a failure flag instead of silently using `{}`:

```ts
let parsedInput: unknown = {};
let inputParseError: string | null = null;
const joined = pending.inputChunks.join('');
if (joined.trim()) {
  try {
    parsedInput = JSON.parse(joined);
  } catch {
    inputParseError =
      `tool input for ${pending.name} was not valid JSON ` +
      `(${joined.length} chars received; possibly truncated). ` +
      `Re-issue the tool call with complete JSON input.`;
    console.warn(`[agent] unparseable tool input for ${pending.name}: ${joined.length} chars`);
  }
}
```

Carry `inputParseError` alongside the pushed `toolUse` block — e.g. keep a
`parseErrorsByToolUseId = new Map<string, string>()` in the round's local
state, set when `inputParseError` is non-null. The `toolUse` block must still
be pushed to `assistantContent` (Bedrock requires every emitted tool_use to
receive a matching tool_result), with `{}` as its input placeholder.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Short-circuit dispatch into the existing error path

In the dispatch loop (currently `for (const block of assistantContent) { … }`
around line 302), before calling `dispatchTool`, check the map:

```ts
const parseError = parseErrorsByToolUseId.get(toolUseId);
if (parseError) {
  toolResultContent.push({
    toolResult: { toolUseId, content: [{ text: parseError }], status: 'error' },
  });
  traceRound.tools.push({ name, input: '<unparseable>', ok: false, error: parseError });
  yield { type: 'tool_result', name: name as AgentToolName, ok: false, error: parseError };
  continue;
}
```

This mirrors the existing catch branch (lines 340-352) exactly — same
structures, same yield shape — so the model gets a corrective error message
and can retry with well-formed input, and the client renders it like any
other failed tool call.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Regression coverage

If plan 004's vitest baseline is present, add
`web/lib/__tests__/agent-parse.test.ts` exercising the generator with a
stubbed Bedrock client whose stream yields a tool_use with garbage input
chunks, asserting the yielded events contain `tool_result` with `ok: false`
and an error mentioning "not valid JSON" — check how `runAgent` (or the
exported generator's name — read the top of `agent.ts`) receives its Bedrock
client; if the client is not injectable, SKIP the unit test and instead
verify behavior manually per Step 4, noting the gap in the plan index.

**Verify**: `pnpm --filter @vaultmark/web test` → pass (or documented skip).

### Step 4: Confirm no chat regression

**Verify**: `pnpm build && pnpm test:e2e -- --grep chat` → all pass (the chat
specs stub Bedrock via `page.route`, so they confirm the protocol shape is
unchanged).

## Test plan

- Unit (if injectable): unparseable-input → error tool_result, well-formed
  input unaffected, empty input still dispatches with `{}`.
- E2E: existing chat specs stay green.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `grep -n "parsedInput = {}" web/lib/agent.ts` no longer shows a silent catch-assign (the catch records an error instead)
- [ ] Existing chat e2e specs pass
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The excerpted code has moved/changed (drift).
- Bedrock rejects the conversation when a tool_result with `status:'error'`
  answers a tool_use whose input was `{}` — if the API errors on this shape,
  report; do not restructure the loop.
- The Bedrock client cannot be stubbed for the unit test AND an e2e path can't
  simulate truncated input — note it and rely on Steps 1-2 + chat suite.

## Maintenance notes

- If tool-input streaming is ever chunk-validated earlier (e.g. JSON repair),
  this guard stays as the last line of defense.
- Reviewer: confirm every emitted tool_use still gets exactly one tool_result
  (Bedrock protocol invariant), including the parse-error path.
