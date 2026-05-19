import matter from 'gray-matter';
import type { Tool } from '@aws-sdk/client-bedrock-runtime';

import { getObject } from '@/lib/s3';
import { search } from '@/lib/search';
import {
  inferScopeFromKey,
  resolveScope,
  type Scope,
} from '@/lib/scope';

/**
 * Three tools exposed to the Ask-Wiki agent. Each is a direct in-process
 * function call — no HTTP, no separate service. The route handler dispatches
 * tool-use events to these functions and round-trips their result back to
 * the model.
 */

export type AgentToolName = 'search_vault' | 'read_document' | 'propose_page';

export type ScopeMode = 'shared' | 'user' | 'both';

// ─── Tool specs (Bedrock toolConfig) ─────────────────────────────────────

/**
 * Bedrock's `Tool` shape:
 *   { toolSpec: { name, description, inputSchema: { json: <JSONSchema7> } } }
 *
 * Schemas are written to the model in the system prompt; the model emits
 * tool_use blocks with `input` matching the schema.
 */
export const TOOL_SPECS: Tool[] = [
  {
    toolSpec: {
      name: 'search_vault',
      description:
        'Search the user\'s vault for documents relevant to a query. Returns ranked candidate document IDs with titles and snippets. Use when the catalog hint in the system prompt is insufficient.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Free-text query. Matches against titles, snippets, and paths.',
            },
            limit: {
              type: 'integer',
              description: 'Max number of results. Default 8.',
              minimum: 1,
              maximum: 25,
            },
          },
          required: ['query'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'read_document',
      description:
        'Read the full Markdown content of a document by its S3 key. Use this BEFORE citing any document — citations are derived from your read_document calls, not from your response text.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            doc_id: {
              type: 'string',
              description: 'The document\'s S3 key, exactly as it appears in the catalog or in a search_vault result.',
            },
          },
          required: ['doc_id'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'propose_page',
      description:
        'Propose a new Markdown page to add to the user\'s personal wiki. Renders an inline preview the user can save or discard. Only call this when the user explicitly asks you to write, draft, generate, or save a page. Casual question-and-answer turns must NOT call this.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            slug: {
              type: 'string',
              description: 'A kebab-case slug for the page (used as the filename).',
              pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
            },
            title: {
              type: 'string',
              description: 'The page title, as it should appear in the H1 heading.',
            },
            body: {
              type: 'string',
              description: 'The full Markdown body of the page. Do NOT include frontmatter — that is added on save.',
            },
          },
          required: ['slug', 'title', 'body'],
        },
      },
    },
  },
];

// ─── Tool implementations ────────────────────────────────────────────────

export type SearchVaultInput = { query: string; limit?: number };
export type SearchVaultResult = {
  id: string;
  title: string;
  path: string;
  snippet: string;
  rank: number;
};

/**
 * Wrap `lib/search.ts::search` and filter by the active scope set.
 *
 * The Fuse index walks all S3 today (see ROADMAP Phase 6 open gaps), so
 * scope-isolation is achieved by post-filtering on the result IDs. For
 * multi-tenant SaaS this becomes a real isolation layer.
 *
 * Scope membership is determined by inferring the scope from each hit's S3
 * key (`users/<id>/...` → user scope, else shared). A naive substring/
 * startsWith check on `generated/` would match BOTH `generated/wiki/foo.md`
 * (shared) AND `users/<id>/generated/wiki/foo.md` (user) — a real leak we
 * shipped and caught in the v1 postmortem.
 */
export async function searchVault(
  input: SearchVaultInput,
  scopeMode: ScopeMode,
  userId?: string,
): Promise<SearchVaultResult[]> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 25);
  const hits = await search(input.query, limit * 2);
  return hits
    .filter((h) => isInAllowedScope(h.id, scopeMode, userId))
    .slice(0, limit)
    .map((h) => ({
      id: h.id,
      title: h.title,
      path: h.path,
      snippet: h.snippet,
      rank: h.rank,
    }));
}

/**
 * True iff the given S3 key belongs to a scope the chat session is allowed
 * to read from. For `both`, every accessible key passes. For `shared`,
 * only keys whose inferred scope is `shared`. For `user`, only keys
 * belonging to *this user* (the `userId` argument, defaulting to the
 * vault default user).
 */
function isInAllowedScope(key: string, scopeMode: ScopeMode, userId?: string): boolean {
  const inferred = inferScopeFromKey(key);
  if (scopeMode === 'both') {
    if (inferred.scope === 'shared') return true;
    return inferred.userId === (userId ?? resolveScope({ scope: 'user' }).userId);
  }
  if (scopeMode === 'shared') {
    return inferred.scope === 'shared';
  }
  // scopeMode === 'user'
  return (
    inferred.scope === 'user' &&
    inferred.userId === (userId ?? resolveScope({ scope: 'user' }).userId)
  );
}

export type ReadDocumentInput = { doc_id: string };
export type ReadDocumentResult = {
  id: string;
  title: string;
  section: string;
  body: string;
  scope: Scope;
};

/** Read a single document. Throws on missing key; agent loop catches and reports as tool_result error. */
export async function readDocument(input: ReadDocumentInput): Promise<ReadDocumentResult> {
  const raw = await getObject(input.doc_id);
  const { data, content } = matter(raw);

  const fallbackTitle = keyToTitle(input.doc_id);
  const title = typeof data.title === 'string' && data.title.trim() ? data.title : fallbackTitle;
  const section = extractFirstHeading(content) ?? 'Source';
  const scope = inferScopeFromKey(input.doc_id).scope;

  return { id: input.doc_id, title, section, body: content, scope };
}

export type ProposePageInput = { slug: string; title: string; body: string };
export type ProposePageResult = ProposePageInput;

/**
 * Passthrough — does NOT write anything. The agent loop yields a
 * `propose_page` event to the client with this payload; the client renders
 * the preview and the user-initiated Save button hits POST /api/docs.
 */
export function proposePage(input: ProposePageInput): ProposePageResult {
  return input;
}

// ─── Internals ───────────────────────────────────────────────────────────

function keyToTitle(key: string): string {
  const stem = key.split('/').pop()!.replace(/\.md$/, '');
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractFirstHeading(body: string): string | null {
  const match = body.match(/^#+\s+(.+)$/m);
  return match ? match[1].trim() : null;
}
