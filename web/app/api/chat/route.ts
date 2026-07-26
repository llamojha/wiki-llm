import { NextResponse } from 'next/server';
import type { Message } from '@aws-sdk/client-bedrock-runtime';

import { runAgent, type AgentEvent } from '@/lib/agent';
import { filterCatalogToSpace } from '@/lib/agent-prompts';
import { normalizeFolderPath } from '@/lib/vault-paths';
import { getObject } from '@/lib/s3';
import { resolveScope } from '@/lib/scope';
import { resolveScopeOr400 } from '@/lib/http-scope';
import type { ScopeMode } from '@/lib/agent-tools';
import { getAllEntries } from '@/lib/search';
import { ensureVaultMode, vaultMode } from '@/lib/vault-mode';
import { logChatInteraction } from '@/lib/usage-log';
import { flagGuard } from '@/lib/flags';
import { requireSession } from '@/lib/auth-guard';
import { chatRateLimitGuard } from '@/lib/rate-limit';

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
 *     contextSpace?: string,   // pin the conversation to one space/folder
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
  contextSpace?: string;
  forceUnsourcedGeneration?: boolean;
};

export async function POST(req: Request) {
  const gate = await requireSession(req);
  if (gate) return gate;

  const blocked = flagGuard('agent');
  if (blocked) return blocked;

  // Cost backstop: every request below this line invokes Bedrock.
  const limited = await chatRateLimitGuard(req);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as ChatRequestBody;

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ detail: 'message is required' }, { status: 400 });
  }

  const scopeMode: ScopeMode = body.scopeMode ?? 'both';
  const userId = body.userId;

  // Validate a request-supplied userId before it reaches loadCatalog /
  // logScope (both build `users/<id>/…` prefixes), and before the NDJSON
  // stream opens so the rejection is a normal JSON 400.
  if (userId !== undefined) {
    const check = resolveScopeOr400({ scope: 'user', userId });
    if (check instanceof NextResponse) return check;
  }

  // A pinned space narrows the conversation within the active scope. Validate
  // it as a folder path (same segment rules as every other write/browse path)
  // so a malformed value can't reach the key predicates as a regex-ish string.
  // The body is a cast, not a parse, so the type check comes first — a truthy
  // non-string (`{"contextSpace": {}}`) would otherwise reach `.trim()` inside
  // the normalizer and 500 instead of returning this 400.
  if (body.contextSpace !== undefined && typeof body.contextSpace !== 'string') {
    return NextResponse.json({ detail: 'contextSpace must be a string' }, { status: 400 });
  }
  const contextSpace = normalizeFolderPath(body.contextSpace);
  if (contextSpace === null) {
    return NextResponse.json({ detail: 'contextSpace is not a valid folder path' }, { status: 400 });
  }

  // Resolve catalog: load index.md for the relevant scope(s). Best-effort —
  // an empty catalog still allows the agent to function (it just can't
  // use index-first; it'll fall back to search_vault).
  const catalog = contextSpace
    ? filterCatalogToSpace(await loadCatalog(scopeMode, userId), contextSpace)
    : await loadCatalog(scopeMode, userId);

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
          contextSpace: contextSpace || undefined,
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
        // Keep the crash detail server-side; the generic string is what both
        // the client frame and the persisted usage-log error field carry.
        console.error('[chat] agent run failed:', err);
        const detail = 'agent run failed';
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
  // Folders mode has one implicit scope and — in the default browse+agent
  // deployment — no write path to produce `_system/index.md`. Build the catalog
  // straight from the live search index so the agent gets a catalog with zero
  // writes (and never drifts from what's actually in the vault).
  await ensureVaultMode();
  if (vaultMode() === 'folders' || vaultMode() === 'managed') {
    const entries = await getAllEntries();
    return entries
      .map((e) => `- ${e.id} — ${e.title} — ${e.snippet.slice(0, 80)}`)
      .join('\n');
  }

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
