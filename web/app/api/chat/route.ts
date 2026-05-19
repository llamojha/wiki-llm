import { NextResponse } from 'next/server';
import type { Message } from '@aws-sdk/client-bedrock-runtime';

import { runAgent, type AgentEvent } from '@/lib/agent';
import { getObject } from '@/lib/s3';
import { resolveScope } from '@/lib/scope';
import type { ScopeMode } from '@/lib/agent-tools';
import { logChatInteraction } from '@/lib/usage-log';

/**
 * Phase 5 — Ask-Wiki agent endpoint. Streams NDJSON events.
 *
 * Request body:
 *   {
 *     message: string,
 *     history?: Bedrock Message[],
 *     scopeMode?: 'shared' | 'user' | 'both',  // default 'both'
 *     userId?: string,
 *     contextDocId?: string,
 *     forceUnsourcedGeneration?: boolean
 *   }
 *
 * Response: `application/x-ndjson` — one AgentEvent per line.
 *
 * Design ref: `specs/phase-5-ask-wiki-agent.md` — Design Details.
 */

// Run on Node (not Edge) so we can use longer-running streams and node:crypto
// in transitive deps. Vercel allows up to 300s on Node serverless.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ChatRequestBody = {
  message?: string;
  history?: Message[];
  scopeMode?: ScopeMode;
  userId?: string;
  contextDocId?: string;
  forceUnsourcedGeneration?: boolean;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ChatRequestBody;

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ detail: 'message is required' }, { status: 400 });
  }

  const scopeMode: ScopeMode = body.scopeMode ?? 'both';
  const userId = body.userId;

  // Resolve catalog: load index.md for the relevant scope(s). Best-effort —
  // an empty catalog still allows the agent to function (it just can't
  // use index-first; it'll fall back to search_vault).
  const catalog = await loadCatalog(scopeMode, userId);

  // Pick a primary scope for usage logging. For `both`, log against the
  // user's scope since that's where any generated page would land.
  const logScope =
    scopeMode === 'shared'
      ? resolveScope({ scope: 'shared' })
      : resolveScope({ scope: 'user', userId });

  const encoder = new TextEncoder();
  let answerChars = 0;
  let citeCount = 0;
  let toolCalls = 0;
  let errorDetail: string | undefined;
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AgentEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
      };

      try {
        for await (const ev of runAgent({
          message: body.message!,
          history: body.history,
          scopeMode,
          userId,
          catalog,
          contextDocId: body.contextDocId,
          forceUnsourcedGeneration: body.forceUnsourcedGeneration,
          abortSignal: req.signal,
        })) {
          // Tally metrics for the usage log as events flow.
          if (ev.type === 'text') answerChars += ev.delta.length;
          else if (ev.type === 'cite') citeCount++;
          else if (ev.type === 'tool_use') toolCalls++;
          else if (ev.type === 'error') errorDetail = ev.detail;

          send(ev);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'agent crashed';
        errorDetail = detail;
        send({ type: 'error', detail });
      } finally {
        controller.close();
        // Fire-and-forget: never let logging block the response.
        logChatInteraction({
          scope: logScope,
          question: body.message!,
          answerChars,
          citeCount,
          toolCalls,
          durationMs: Date.now() - startedAt,
          forced: body.forceUnsourcedGeneration,
          error: errorDetail,
        }).catch(() => { /* already warned inside */ });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      // Hint to downstream proxies to not buffer the chunked stream.
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Load `_system/index.md` for the active scope(s). For `both`, concatenate
 * shared + user catalogs with section headers so the agent can tell them
 * apart and weight relevance accordingly.
 */
async function loadCatalog(scopeMode: ScopeMode, userId?: string): Promise<string> {
  const shared = resolveScope({ scope: 'shared' });
  const user = resolveScope({ scope: 'user', userId });

  if (scopeMode === 'shared') {
    return (await readIndex(shared.systemKey('index.md'))) ?? '';
  }
  if (scopeMode === 'user') {
    return (await readIndex(user.systemKey('index.md'))) ?? '';
  }
  // both
  const sharedCatalog = (await readIndex(shared.systemKey('index.md'))) ?? '';
  const userCatalog = (await readIndex(user.systemKey('index.md'))) ?? '';

  const parts: string[] = [];
  if (sharedCatalog.trim()) {
    parts.push(`### Shared library\n\n${sharedCatalog}`);
  }
  if (userCatalog.trim()) {
    parts.push(`### My library (${user.userId})\n\n${userCatalog}`);
  }
  return parts.join('\n\n---\n\n');
}

async function readIndex(key: string): Promise<string | null> {
  try {
    return await getObject(key);
  } catch {
    return null;
  }
}
