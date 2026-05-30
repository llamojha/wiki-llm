import type {
  Message,
  ContentBlock,
  SystemContentBlock,
  ToolConfiguration,
} from '@aws-sdk/client-bedrock-runtime';

// Local mirror of `@smithy/types::DocumentType` — what the Bedrock SDK
// expects for `toolUse.input` and `toolResult.content[].json`. Mirrored
// locally to avoid a direct dep on the transitive Smithy package.
type DocumentType =
  | null
  | boolean
  | string
  | number
  | DocumentType[]
  | { [k: string]: DocumentType };

import { converseStream } from '@/lib/bedrock';
import {
  TOOL_SPECS,
  searchVault,
  readDocument,
  proposePage,
  type AgentToolName,
  type ScopeMode,
  type ReadDocumentResult,
} from '@/lib/agent-tools';
import { buildSystemPrompt } from '@/lib/agent-prompts';

/**
 * Agent loop for Phase 5 Ask-Wiki.
 *
 * Drives a Bedrock Converse-stream + tool-use loop. Yields envelope events
 * (text deltas, tool uses, citations, propose-page previews, refusals,
 * done, error). The caller marshals each event onto the NDJSON wire format.
 *
 * Design ref: `specs/phase-5-ask-wiki-agent.md` — Design Details section.
 */

// ─── Public event envelope ───────────────────────────────────────────────

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; name: AgentToolName; input: unknown }
  | { type: 'tool_result'; name: AgentToolName; ok: boolean; error?: string }
  | { type: 'cite'; id: string; title: string; section: string }
  | { type: 'propose_page'; slug: string; title: string; body: string }
  | { type: 'refuse'; reason: 'no-sources'; canForce: boolean; message: string }
  /**
   * Soft signal that the agent produced an answer without grounding it in
   * any document. Distinct from `refuse` — the answer IS shown to the
   * user, but the UI should flag that it's uncited so the reader knows
   * to treat it carefully. Fix #6 — closes the gap where an agent that
   * searches, gets hits, but doesn't read any of them slipped past the
   * refuse check.
   */
  | { type: 'warning'; reason: 'no-reads'; message: string }
  | { type: 'done' }
  | { type: 'error'; detail: string };

export type RunAgentOpts = {
  message: string;
  history?: Message[];
  scopeMode: ScopeMode;
  userId?: string;
  catalog: string;
  /**
   * Relative S3 key of the document the user has open in the reader. When
   * present, the agent loop resolves its title once and embeds it in the
   * system prompt as "Currently-open document" so questions like "what
   * does this say?" target the right doc instead of catalog-matching by
   * title similarity.
   */
  contextDocId?: string;
  forceUnsourcedGeneration?: boolean;
  /**
   * Propagated to the Bedrock SDK so the server-side Converse call is
   * cancelled when the client disconnects (see route handler — request's
   * AbortSignal feeds this).
   */
  abortSignal?: AbortSignal;
};

const MAX_ROUNDS = 6;
const MAX_TOKENS_PER_TURN = 4096;

// Live per-round tracing. Off by default; set DEBUG_AGENT=1 to stream each
// round's stopReason and every tool call+result to the server log as the run
// happens (useful when reproducing a loop interactively). Independent of this
// flag, the full trace is always dumped if the loop exhausts MAX_ROUNDS —
// that's the failure we're hunting, so it shouldn't need opt-in to be visible.
const DEBUG_AGENT = process.env.DEBUG_AGENT === '1' || process.env.DEBUG_AGENT === 'true';

/** One dispatched tool call within a round, for the diagnostic trace. */
type TraceTool = { name: string; input: unknown; ok: boolean; error?: string };
/** One agent turn: the model's stopReason plus the tools it triggered. */
type TraceRound = { round: number; stopReason?: string; tools: TraceTool[] };

/**
 * Compact a tool input for logging — drops large fields (e.g. a propose_page
 * `body`) to a length marker so the trace stays readable and doesn't dump
 * whole documents into the server log.
 */
function summarizeInput(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = typeof v === 'string' && v.length > 120 ? `<${v.length} chars>` : v;
  }
  return out;
}

// ─── Loop ────────────────────────────────────────────────────────────────

export async function* runAgent(opts: RunAgentOpts): AsyncGenerator<AgentEvent> {
  // If the client provided a contextDocId (user has a doc open in the
  // reader), resolve its title and any frontmatter once so the system
  // prompt can name it directly. Scope-checked — silently dropped if the
  // doc is outside the active scope, so a crafty context can't bypass it.
  const contextDocInfo = await resolveContextDoc(
    opts.contextDocId,
    opts.scopeMode,
    opts.userId,
  );

  const systemText = buildSystemPrompt({
    catalog: opts.catalog,
    scopeMode: opts.scopeMode,
    contextDocTitle: contextDocInfo?.title,
    contextDocId: contextDocInfo?.id,
    forceUnsourcedGeneration: opts.forceUnsourcedGeneration,
  });
  const system: SystemContentBlock[] = [{ text: systemText }];

  const toolConfig: ToolConfiguration = { tools: TOOL_SPECS };

  const messages: Message[] = [
    ...(opts.history ?? []),
    { role: 'user', content: [{ text: opts.message }] },
  ];

  // Track docs read in this run for deterministic citation emission. Keyed
  // by doc_id so duplicate reads don't double-cite.
  const reads = new Map<string, ReadDocumentResult>();
  // Track whether the agent has called search_vault yet — needed for the
  // refuse-on-no-sources logic in non-forced mode.
  let searchCallsMade = 0;
  let searchHitsFound = 0;

  // Diagnostic trace of every round + tool call. Always dumped if the loop
  // exhausts MAX_ROUNDS (the "exceeded N rounds" failure), and live-logged
  // per round when DEBUG_AGENT is set.
  const trace: TraceRound[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const traceRound: TraceRound = { round, tools: [] };
    trace.push(traceRound);
    let stopReason: string | undefined;
    const assistantContent: ContentBlock[] = [];
    // Per-turn accumulator for in-flight tool_use blocks, keyed by content-
    // block index.
    type PendingToolUse = {
      toolUseId: string;
      name: string;
      inputChunks: string[];
    };
    const pendingByIndex = new Map<number, PendingToolUse>();
    // Per-turn buffer for text blocks, keyed by content-block index.
    const textByIndex = new Map<number, string>();

    let stream: AsyncIterable<unknown>;
    try {
      stream = await converseStream(
        {
          system,
          messages,
          toolConfig,
          inferenceConfig: { maxTokens: MAX_TOKENS_PER_TURN },
        },
        opts.abortSignal,
      );
    } catch (err) {
      yield { type: 'error', detail: err instanceof Error ? err.message : 'Bedrock request failed' };
      return;
    }

    // Consume the model's stream events for this turn.
    // The SDK's union is wide; we narrow at the use-site.
    for await (const ev of stream as AsyncIterable<Record<string, unknown>>) {
      // contentBlockStart — may carry a toolUse start.
      if ('contentBlockStart' in ev && ev.contentBlockStart) {
        const start = ev.contentBlockStart as {
          contentBlockIndex?: number;
          start?: { toolUse?: { toolUseId?: string; name?: string } };
        };
        const idx = start.contentBlockIndex ?? 0;
        const tu = start.start?.toolUse;
        if (tu && tu.toolUseId && tu.name) {
          pendingByIndex.set(idx, { toolUseId: tu.toolUseId, name: tu.name, inputChunks: [] });
        }
      }

      // contentBlockDelta — incremental text or tool-input JSON fragment.
      if ('contentBlockDelta' in ev && ev.contentBlockDelta) {
        const d = ev.contentBlockDelta as {
          contentBlockIndex?: number;
          delta?: { text?: string; toolUse?: { input?: string } };
        };
        const idx = d.contentBlockIndex ?? 0;
        if (d.delta?.text) {
          yield { type: 'text', delta: d.delta.text };
          textByIndex.set(idx, (textByIndex.get(idx) ?? '') + d.delta.text);
        }
        if (d.delta?.toolUse?.input !== undefined) {
          const pending = pendingByIndex.get(idx);
          if (pending) pending.inputChunks.push(d.delta.toolUse.input);
        }
      }

      // contentBlockStop — finalize a block (parse tool input here).
      if ('contentBlockStop' in ev && ev.contentBlockStop) {
        const stop = ev.contentBlockStop as { contentBlockIndex?: number };
        const idx = stop.contentBlockIndex ?? 0;
        if (textByIndex.has(idx)) {
          assistantContent.push({ text: textByIndex.get(idx)! });
        }
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
      }

      // messageStop — turn-end signal carrying the stopReason.
      if ('messageStop' in ev && ev.messageStop) {
        const ms = ev.messageStop as { stopReason?: string };
        stopReason = ms.stopReason;
      }
    }

    // Append the assistant's turn to the conversation.
    messages.push({ role: 'assistant', content: assistantContent });

    traceRound.stopReason = stopReason;
    if (DEBUG_AGENT) {
      console.log(`[agent] round ${round} stopReason=${stopReason ?? '<missing>'}`);
    }

    // If the model is done, emit citations + done and exit.
    if (stopReason === 'end_turn' || stopReason === 'stop_sequence') {
      for (const r of reads.values()) {
        yield { type: 'cite', id: r.id, title: r.title, section: r.section };
      }
      if (!opts.forceUnsourcedGeneration) {
        if (searchCallsMade > 0 && searchHitsFound === 0 && reads.size === 0) {
          // Hard refusal: agent searched, found nothing, drafted nothing.
          yield {
            type: 'refuse',
            reason: 'no-sources',
            canForce: true,
            message: 'I couldn\'t find anything in your vault on this topic. If you\'d like me to draft from general knowledge without citations, use the Draft anyway button.',
          };
        } else if (reads.size === 0) {
          // Soft warning: agent produced an answer without grounding it in
          // any document. The answer is shown but the reader should be
          // told it's uncited (the citation discipline didn't bite).
          yield {
            type: 'warning',
            reason: 'no-reads',
            message: 'This answer was produced without reading any source document — treat it as uncited.',
          };
        }
      }
      yield { type: 'done' };
      return;
    }

    if (stopReason !== 'tool_use') {
      // Unexpected stop (e.g., max_tokens). Surface and bail.
      yield { type: 'error', detail: `Unexpected stopReason: ${stopReason ?? '<missing>'}` };
      return;
    }

    // Dispatch every tool_use in this turn and collect a user-role
    // tool_result message to pass back next round.
    const toolResultContent: ContentBlock[] = [];
    for (const block of assistantContent) {
      if (!('toolUse' in block) || !block.toolUse) continue;
      const { toolUseId, name, input } = block.toolUse;
      if (!toolUseId || !name) continue;

      yield { type: 'tool_use', name: name as AgentToolName, input };

      try {
        const result = await dispatchTool(
          name as AgentToolName,
          input as Record<string, unknown>,
          opts,
        );

        // Hook side effects for the post-loop refusal check.
        if (name === 'search_vault') {
          searchCallsMade++;
          if (Array.isArray(result) && result.length > 0) searchHitsFound += result.length;
        }
        if (name === 'read_document') {
          const r = result as ReadDocumentResult;
          if (r && r.id && !reads.has(r.id)) reads.set(r.id, r);
        }
        if (name === 'propose_page') {
          const p = result as ReturnType<typeof proposePage>;
          yield { type: 'propose_page', slug: p.slug, title: p.title, body: p.body };
        }

        toolResultContent.push({
          toolResult: {
            toolUseId,
            content: [{ json: toolResultToJson(name as AgentToolName, result) as DocumentType }],
            status: 'success',
          },
        });
        traceRound.tools.push({ name, input: summarizeInput(input), ok: true });
        if (DEBUG_AGENT) console.log(`[agent]   tool ${name} ok`, summarizeInput(input));
        yield { type: 'tool_result', name: name as AgentToolName, ok: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'tool dispatch failed';
        toolResultContent.push({
          toolResult: {
            toolUseId,
            content: [{ text: detail }],
            status: 'error',
          },
        });
        traceRound.tools.push({ name, input: summarizeInput(input), ok: false, error: detail });
        if (DEBUG_AGENT) console.warn(`[agent]   tool ${name} ERROR: ${detail}`, summarizeInput(input));
        yield { type: 'tool_result', name: name as AgentToolName, ok: false, error: detail };
      }
    }
    messages.push({ role: 'user', content: toolResultContent });
  }

  // Loop exhausted: the model issued tool_use for all MAX_ROUNDS turns and
  // never returned end_turn. Dump the full trace so the tool sequence behind
  // the failure is visible without needing to reproduce with DEBUG_AGENT.
  console.warn(
    `[agent] exhausted ${MAX_ROUNDS} rounds without end_turn — forcing final answer. trace:\n` +
      trace
        .map(
          (r) =>
            `  round ${r.round} (stop=${r.stopReason ?? '<missing>'}): ` +
            (r.tools.length
              ? r.tools
                  .map(
                    (t) =>
                      `${t.name}(${JSON.stringify(t.input)})${t.ok ? '' : ` !ERR:${t.error}`}`,
                  )
                  .join(', ')
              : '<no tools>'),
        )
        .join('\n'),
  );

  // Graceful fallback: one final Converse call WITHOUT toolConfig so the
  // model has no choice but to produce a text answer using whatever it has
  // already read. Better than dead-ending the user with an error, and any
  // documents already read still cite normally.
  //
  // We nudge the model in a system-style user turn so it knows the budget
  // is spent and it should wrap up with what it has.
  messages.push({
    role: 'user',
    content: [
      {
        text:
          'You have used your tool-use budget. Do NOT request any more tools. Produce your final answer now using only the documents you have already read. Cite them with [n] markers as instructed.',
      },
    ],
  });

  try {
    const finalStream = await converseStream(
      {
        system,
        messages,
        inferenceConfig: { maxTokens: MAX_TOKENS_PER_TURN },
        // toolConfig intentionally omitted — forces a text answer.
      },
      opts.abortSignal,
    );
    for await (const ev of finalStream as AsyncIterable<Record<string, unknown>>) {
      if ('contentBlockDelta' in ev && ev.contentBlockDelta) {
        const d = ev.contentBlockDelta as { delta?: { text?: string } };
        if (d.delta?.text) yield { type: 'text', delta: d.delta.text };
      }
    }
    for (const r of reads.values()) {
      yield { type: 'cite', id: r.id, title: r.title, section: r.section };
    }
    if (!opts.forceUnsourcedGeneration && reads.size === 0) {
      yield {
        type: 'warning',
        reason: 'no-reads',
        message:
          'This answer was produced without reading any source document — treat it as uncited.',
      };
    }
    yield { type: 'done' };
  } catch (err) {
    yield {
      type: 'error',
      detail: err instanceof Error ? err.message : 'forced final-answer turn failed',
    };
  }
}

// ─── Tool dispatch ───────────────────────────────────────────────────────

async function dispatchTool(
  name: AgentToolName,
  input: Record<string, unknown>,
  opts: RunAgentOpts,
): Promise<unknown> {
  switch (name) {
    case 'search_vault':
      return await searchVault(
        {
          query: String(input.query ?? ''),
          limit: typeof input.limit === 'number' ? input.limit : undefined,
        },
        opts.scopeMode,
        opts.userId,
      );
    case 'read_document':
      return await readDocument(
        { doc_id: String(input.doc_id ?? '') },
        opts.scopeMode,
        opts.userId,
      );
    case 'propose_page':
      return proposePage({
        slug: String(input.slug ?? ''),
        title: String(input.title ?? ''),
        body: String(input.body ?? ''),
      });
  }
}

/**
 * Marshal a tool result for the back-channel to the model. For `propose_page`
 * we deliberately send a *confirmation* rather than echoing the body — the
 * body already went to the client via the propose_page event, and re-sending
 * it would just inflate the context.
 *
 * Bedrock's `toolResult.content[].json` field must be a JSON *object* at the
 * top level — a bare array (as `search_vault` returns) is rejected with
 * "The format of the value at ...toolResult.content.0.json is invalid." So we
 * wrap any non-object result in an object before handing it back to the model.
 */
function toolResultToJson(name: AgentToolName, result: unknown): Record<string, unknown> {
  if (name === 'propose_page') {
    return { status: 'preview-shown', note: 'The preview was shown to the user. They will decide whether to save.' };
  }
  if (Array.isArray(result)) {
    return { results: result };
  }
  if (result === null || typeof result !== 'object') {
    return { value: result };
  }
  return result as Record<string, unknown>;
}

/**
 * Best-effort resolution of the user's currently-open document. Returns
 * `{ id, title }` if the doc is in the active scope and readable; `null`
 * otherwise. Failures are swallowed — a missing or out-of-scope context
 * doc is not worth aborting the chat over, it just means the agent loses
 * the "you are looking at <X>" hint.
 */
async function resolveContextDoc(
  contextDocId: string | undefined,
  scopeMode: ScopeMode,
  userId: string | undefined,
): Promise<{ id: string; title: string } | null> {
  if (!contextDocId) return null;
  try {
    const doc = await readDocument({ doc_id: contextDocId }, scopeMode, userId);
    return { id: doc.id, title: doc.title };
  } catch {
    return null;
  }
}
