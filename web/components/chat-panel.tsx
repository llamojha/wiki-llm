'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { ICONS } from '@/lib/icons';
import { SUGGESTIONS } from '@/lib/canned-replies';
import { renderMarkdown } from '@/lib/markdown';
import type { Cite, Doc, SanitizedHtml } from '@/lib/types';
import { DEFAULT_USER_ID } from '@/lib/vault-paths';

/**
 * Phase 5 — Ask-Wiki Agent chat panel.
 *
 * Streams from `POST /api/chat` (NDJSON events), renders text deltas live,
 * citations as they arrive, an inline propose-page preview block on
 * explicit generation, and a "Draft anyway" affordance when the agent
 * refuses an unsourced generation request.
 *
 * Design ref: `specs/phase-5-ask-wiki-agent.md`.
 */

type ScopeMode = 'shared' | 'user' | 'both';

type PageProposal = { slug: string; title: string; body: string };

type RefuseInfo = { canForce: boolean; message: string };

type WarningInfo = { reason: string; message: string };

type Message = {
  id: string;
  role: 'user' | 'assistant';
  /** For user messages: the raw text. For assistant: accumulating buffer of text deltas. */
  text: string;
  /** Final rendered HTML — set when the stream completes. */
  html?: SanitizedHtml;
  /** Original user question — present on assistant messages for follow-ups (Save as page title). */
  question?: string;
  cites: Cite[];
  proposal?: PageProposal;
  refuse?: RefuseInfo;
  warning?: WarningInfo;
  error?: string;
  /** True while the stream is still feeding this message. */
  streaming?: boolean;
};

export type ChatPanelDraft = { title: string; body: string };

type ChatPanelProps = {
  open: boolean;
  onClose: () => void;
  onOpenDoc: (id: string) => void;
  /** Post-hoc Save: open the Editor pre-filled with this draft. */
  onDraftFromChat: (draft: ChatPanelDraft) => void;
  contextDoc?: Doc;
};

const ASK_EVENT = 'wikillm:ask';

/** Cap how many prior messages we send back to the model. Bounds token cost. */
const HISTORY_LIMIT = 10;

/**
 * Convert the chat panel's message list into Bedrock-shaped history for the
 * next /api/chat call. Drops the intro stub, drops error-only messages,
 * keeps only completed assistant text (no streaming-in-progress messages),
 * and caps to the most recent HISTORY_LIMIT entries.
 */
function toBedrockHistory(messages: Message[]): { role: 'user' | 'assistant'; content: [{ text: string }] }[] {
  const out: { role: 'user' | 'assistant'; content: [{ text: string }] }[] = [];
  for (const m of messages) {
    if (m.id === 'intro') continue;
    if (m.streaming) continue;
    const text = m.text.trim();
    if (!text) continue;
    out.push({ role: m.role, content: [{ text }] });
  }
  return out.slice(-HISTORY_LIMIT);
}

const SCOPE_LABEL: Record<ScopeMode, string> = {
  shared: 'shared library only',
  user: 'my library only',
  both: 'shared + my library',
};

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Light streaming Markdown — renders `**bold**`, `*italic*`, and `` `code` ``
 * inline during the stream so users don't see literal `**` etc. between
 * deltas. Skips headings, fences, links — those wait for the final
 * `renderMarkdown` pass on `done`. The regex is intentionally
 * non-overlapping; sequences with unmatched delimiters render as text.
 *
 * Fix #7 — replaces raw pre-wrap text during streaming.
 */
function renderLightInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Match in priority order: code (most literal), then bold, then italic.
  // Use non-greedy bodies; require at least one char between delimiters.
  const re = /(`[^`\n]+?`|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      parts.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return parts;
}

function buildPostHocDraft(msg: Message): ChatPanelDraft {
  const title = msg.question
    ? msg.question.replace(/\?$/, '').slice(0, 80)
    : 'Saved answer';
  const lines: string[] = [`# ${title}`, ''];
  if (msg.text.trim()) lines.push(msg.text.trim(), '');
  if (msg.cites.length) {
    lines.push('## Citations', '');
    msg.cites.forEach((c, i) => {
      lines.push(`${i + 1}. **${c.title}** — _${c.section}_ (\`${c.id ?? ''}\`)`);
    });
    lines.push('');
  }
  return { title, body: lines.join('\n') };
}

export function ChatPanel({ open, onClose, onOpenDoc, onDraftFromChat, contextDoc }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(() => [introMessage()]);
  const [input, setInput] = useState('');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('both');
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Authoritative text buffer per assistant message, keyed by message id.
  // Mirrors `messages[i].text` for streaming messages so we can read the
  // final value synchronously after the stream ends — avoids racing React's
  // batching when we want to run renderMarkdown on the completed text.
  const textBufRef = useRef<Map<string, string>>(new Map());
  // Tracks the latest tool_use event per assistant message (Fix #8 — live
  // activity indicator). Read in render via tickCount to force re-renders.
  const activityRef = useRef<Map<string, string>>(new Map());
  const [, forceTick] = useState(0);

  // Autoscroll on new content.
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, thinking, open]);

  // Abort any in-flight request when the panel closes.
  useEffect(() => {
    if (!open && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setThinking(false);
    }
  }, [open]);

  const patchMessage = useCallback((id: string, patch: Partial<Message> | ((m: Message) => Partial<Message>)) => {
    setMessages((curr) =>
      curr.map((m) => {
        if (m.id !== id) return m;
        const next = typeof patch === 'function' ? patch(m) : patch;
        return { ...m, ...next };
      }),
    );
  }, []);

  const send = useCallback(
    async (text: string, opts?: { forceUnsourcedGeneration?: boolean; questionOverride?: string }) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const userMsg: Message = {
        id: makeId('u'),
        role: 'user',
        text: trimmed,
        cites: [],
      };
      const assistantMsg: Message = {
        id: makeId('a'),
        role: 'assistant',
        text: '',
        question: opts?.questionOverride ?? trimmed,
        cites: [],
        streaming: true,
      };
      // Snapshot history BEFORE appending the new turn so the request body
      // carries the prior conversation, not the in-flight placeholder.
      // Fix #5 — multi-turn context was missing in v1.
      const history = toBedrockHistory(messages);
      setMessages((m) => [...m, userMsg, assistantMsg]);
      setInput('');
      setThinking(true);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            scopeMode,
            ...(history.length ? { history } : {}),
            ...(scopeMode !== 'shared' ? { userId: DEFAULT_USER_ID } : {}),
            ...(contextDoc && 'kind' in contextDoc ? { contextDocId: contextDoc.id } : {}),
            ...(opts?.forceUnsourcedGeneration ? { forceUnsourcedGeneration: true } : {}),
          }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          patchMessage(assistantMsg.id, {
            error: data.detail || `Chat request failed (${res.status})`,
            streaming: false,
          });
          setThinking(false);
          return;
        }

        const reader = res.body.getReader();
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
            let ev: { type: string; [k: string]: unknown };
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            handleEvent(ev, assistantMsg.id);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        patchMessage(assistantMsg.id, {
          error: err instanceof Error ? err.message : 'Network error',
          streaming: false,
        });
      } finally {
        setThinking(false);
      }

      // Final render: convert accumulated text to sanitized HTML for the
      // bubble. Done after the stream so we don't try to render incomplete
      // Markdown mid-stream (fences, links).
      const final = textBufRef.current.get(assistantMsg.id) ?? '';
      activityRef.current.delete(assistantMsg.id);
      forceTick((n) => n + 1);
      if (final) {
        try {
          const html = await renderMarkdown(final);
          patchMessage(assistantMsg.id, { html, streaming: false });
        } catch {
          patchMessage(assistantMsg.id, { streaming: false });
        }
      } else {
        patchMessage(assistantMsg.id, { streaming: false });
      }
    },
    [scopeMode, contextDoc, patchMessage, messages],
  );

  const handleEvent = useCallback(
    (ev: { type: string; [k: string]: unknown }, msgId: string) => {
      switch (ev.type) {
        case 'text': {
          const delta = String(ev.delta ?? '');
          // Authoritative buffer (Fix #3 — sync read after stream ends).
          textBufRef.current.set(msgId, (textBufRef.current.get(msgId) ?? '') + delta);
          patchMessage(msgId, (m) => ({ text: m.text + delta }));
          // Text starts flowing → clear any stale activity indicator.
          if (activityRef.current.has(msgId)) {
            activityRef.current.delete(msgId);
            forceTick((n) => n + 1);
          }
          break;
        }
        case 'tool_use': {
          // Fix #8 — surface live activity. Map tool name + (partial) input
          // to a human-readable indicator.
          const name = String(ev.name ?? '');
          const input = (ev.input ?? {}) as Record<string, unknown>;
          let label = name;
          if (name === 'search_vault' && input.query) label = `searching for "${String(input.query)}"…`;
          else if (name === 'read_document' && input.doc_id) label = `reading ${String(input.doc_id).split('/').pop()}…`;
          else if (name === 'propose_page') label = 'drafting a new page…';
          activityRef.current.set(msgId, label);
          forceTick((n) => n + 1);
          break;
        }
        case 'cite':
          patchMessage(msgId, (m) => ({
            cites: [
              ...m.cites,
              { id: String(ev.id ?? ''), title: String(ev.title ?? ''), section: String(ev.section ?? '') },
            ],
          }));
          break;
        case 'propose_page':
          patchMessage(msgId, {
            proposal: {
              slug: String(ev.slug ?? ''),
              title: String(ev.title ?? ''),
              body: String(ev.body ?? ''),
            },
          });
          break;
        case 'refuse':
          patchMessage(msgId, {
            refuse: {
              canForce: Boolean(ev.canForce),
              message: String(ev.message ?? ''),
            },
          });
          break;
        case 'warning':
          patchMessage(msgId, {
            warning: {
              reason: String(ev.reason ?? ''),
              message: String(ev.message ?? ''),
            },
          });
          break;
        case 'error':
          patchMessage(msgId, { error: String(ev.detail ?? 'agent error'), streaming: false });
          break;
        case 'done':
          // Streaming flag is cleared once renderMarkdown completes below.
          break;
        // tool_use / tool_result are informational; ignore for now.
      }
    },
    [patchMessage],
  );

  // Cross-component "ask" event from elsewhere in the app (e.g. home view).
  useEffect(() => {
    const onAsk = (e: Event) => {
      send((e as CustomEvent<string>).detail);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, [send]);

  const saveProposal = useCallback(
    async (msg: Message) => {
      if (!msg.proposal) return;
      setSaving((s) => new Set(s).add(msg.id));
      try {
        const res = await fetch('/api/docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: msg.proposal.title,
            body: msg.proposal.body,
            slug: msg.proposal.slug,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setErrorToast(data.detail || 'Failed to save page');
          return;
        }
        const data = await res.json();
        patchMessage(msg.id, { proposal: undefined });
        onOpenDoc(data.id);
      } catch {
        setErrorToast('Network error — could not save page');
      } finally {
        setSaving((s) => {
          const next = new Set(s);
          next.delete(msg.id);
          return next;
        });
      }
    },
    [onOpenDoc, patchMessage],
  );

  const discardProposal = useCallback(
    (msg: Message) => {
      patchMessage(msg.id, { proposal: undefined });
    },
    [patchMessage],
  );

  const draftAnyway = useCallback(
    (msg: Message) => {
      if (!msg.question) return;
      // Clear the refusal from the prior message so the UI doesn't show a stale
      // button after the next response arrives.
      patchMessage(msg.id, { refuse: undefined });
      send(msg.question, { forceUnsourcedGeneration: true, questionOverride: msg.question });
    },
    [patchMessage, send],
  );

  const savePostHoc = useCallback(
    (msg: Message) => {
      const draft = buildPostHocDraft(msg);
      onClose();
      onDraftFromChat(draft);
    },
    [onClose, onDraftFromChat],
  );

  return (
    <div className={'chat-panel' + (open ? ' open' : '')}>
      <div className="chat-head">
        {ICONS.spark}
        <span>Ask the wiki</span>
        <span className="badge-beta">MVP 2 · beta</span>
        <span style={{ flex: 1 }}></span>
        <button className="icon-btn" onClick={onClose} title="Close">{ICONS.close}</button>
      </div>

      <div className="chat-context">
        <span style={{ color: 'var(--fg-3)' }}>scope</span>
        <div className="space-select" style={{ gap: 4 }}>
          {(['shared', 'user', 'both'] as const).map((s) => (
            <button
              key={s}
              className={'space-pill' + (scopeMode === s ? ' on' : '')}
              disabled={thinking}
              onClick={() => setScopeMode(s)}
              title={SCOPE_LABEL[s]}
            >
              {s === 'shared' ? ICONS.globe : s === 'user' ? (ICONS.user ?? ICONS.lock) : ICONS.globe}
              <span>{s === 'shared' ? 'Shared' : s === 'user' ? 'My' : 'Both'}</span>
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }}></span>
        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
          {contextDoc ? 'context: current doc' : SCOPE_LABEL[scopeMode]}
        </span>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {messages.map((m) => (
          <div key={m.id} className={'msg ' + m.role}>
            <div className="bubble">
              {m.role === 'user' ? (
                <p>{m.text}</p>
              ) : m.html ? (
                <div dangerouslySetInnerHTML={{ __html: m.html }} />
              ) : m.text ? (
                <p style={{ whiteSpace: 'pre-wrap' }}>{renderLightInline(m.text)}</p>
              ) : m.error ? null : (
                <span style={{ color: 'var(--fg-3)' }}>…</span>
              )}
              {m.error && (
                <p style={{ color: 'var(--red, #ef4444)', fontSize: 12 }}>
                  {ICONS.warn} {m.error}
                </p>
              )}
              {m.role === 'assistant' && m.streaming && activityRef.current.get(m.id) && (
                <p className="agent-activity">
                  <span className="spinner"></span>
                  <span style={{ marginLeft: 6 }}>{activityRef.current.get(m.id)}</span>
                </p>
              )}
            </div>

            {m.cites.length > 0 && (
              <div className="citations">
                {m.cites.map((c, j) => (
                  <button
                    key={`${m.id}-c-${j}`}
                    className="citation"
                    onClick={() => c.id && onOpenDoc(c.id)}
                  >
                    <span className="num">{j + 1}</span>
                    <span className="ctitle">{c.title} <span style={{ color: 'var(--fg-3)' }}>· {c.section}</span></span>
                  </button>
                ))}
              </div>
            )}

            {m.refuse && (
              <div className="msg-actions" style={{ marginTop: 4 }}>
                {m.refuse.canForce && (
                  <button className="msg-action primary" onClick={() => draftAnyway(m)}>
                    {ICONS.spark} Draft anyway (no sources)
                  </button>
                )}
                <span className="msg-meta">{m.refuse.message}</span>
              </div>
            )}

            {m.warning && (
              <div className="msg-warning">
                {ICONS.warn} <span>{m.warning.message}</span>
              </div>
            )}

            {m.proposal && (
              <div className="propose-page">
                <div className="propose-page-meta">Proposed page · preview</div>
                <div className="propose-page-title">{m.proposal.title}</div>
                <pre className="propose-page-body">{m.proposal.body}</pre>
                <div className="msg-actions" style={{ marginTop: 8 }}>
                  <button
                    className="msg-action primary"
                    onClick={() => saveProposal(m)}
                    disabled={saving.has(m.id)}
                  >
                    {ICONS.check} {saving.has(m.id) ? 'Saving…' : `Save to My wiki as ${m.proposal.slug}.md`}
                  </button>
                  <button className="msg-action" onClick={() => discardProposal(m)}>
                    Discard
                  </button>
                </div>
              </div>
            )}

            {m.role === 'assistant' && !m.streaming && !m.proposal && !m.refuse && m.text && !m.error && (
              <div className="msg-actions">
                <button className="msg-action primary" onClick={() => savePostHoc(m)}>
                  {ICONS.plus} Save as page in My wiki
                </button>
                <button className="msg-action">{ICONS.copy} Copy</button>
                <span style={{ flex: 1 }}></span>
                {m.cites.length > 0 && (
                  <span className="msg-meta">grounded in {m.cites.length} source{m.cites.length > 1 ? 's' : ''}</span>
                )}
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div className="msg assistant">
            <div className="thinking">
              <span className="dt"></span><span className="dt"></span><span className="dt"></span>
              <span style={{ marginLeft: 4 }}>searching docs…</span>
            </div>
          </div>
        )}
        {messages.length <= 1 && (
          <div className="chat-suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
      </div>

      <div className="chat-input">
        <div className="chat-input-box">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about anything in your docs…"
            rows={1}
          />
          <div className="chat-input-actions">
            <button className="btn ghost icon-only" title="Attach context">{ICONS.attach}</button>
            <span style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {contextDoc ? 'context: current doc' : `context: ${SCOPE_LABEL[scopeMode]}`}
            </span>
            <span className="grow"></span>
            <button className="btn primary" onClick={() => send(input)} disabled={!input.trim() || thinking}>
              {ICONS.send} Send
            </button>
          </div>
        </div>
      </div>

      {errorToast && (
        <div
          style={{
            position: 'absolute',
            bottom: 76,
            left: 12,
            right: 12,
            padding: '8px 12px',
            borderRadius: 4,
            background: 'var(--red, #ef4444)',
            color: '#fff',
            fontSize: 12,
          }}
          onClick={() => setErrorToast(null)}
        >
          {errorToast}
        </div>
      )}
    </div>
  );
}

function introMessage(): Message {
  return {
    id: 'intro',
    role: 'assistant',
    text:
      "Hi — I'm the Vaultmark assistant. Ask me anything about your vault. I'll search, cite my sources, and refuse if I can't find what you're asking about.\n\nUse the scope toggle above to control whether I read from shared content, your personal wiki, or both.",
    cites: [],
    html: undefined,
  };
}
