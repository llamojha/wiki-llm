'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ICONS } from '@/lib/icons';
import { CANNED_REPLIES, DEFAULT_REPLY, SUGGESTIONS } from '@/lib/canned-replies';
import type { Cite, Doc, GeneratedDoc } from '@/lib/mock/data';

type Message = {
  role: 'user' | 'assistant';
  content: ReactNode;
  question?: string;
  cites?: Cite[];
};

type ChatPanelProps = {
  open: boolean;
  onClose: () => void;
  onOpenDoc: (id: string) => void;
  onSavePage: (page: GeneratedDoc) => void;
  contextDoc?: Doc;
};

const INITIAL_MESSAGES: Message[] = [
  {
    role: 'assistant',
    content: <>
      <p>Hi — I'm the WikiLLM assistant. I can answer questions grounded in your team's docs, with citations.</p>
      <p>Ask me anything about runbooks, services, or your personal notes. I only see what you have access to.</p>
    </>,
    cites: [],
  },
];

export function ChatPanel({ open, onClose, onOpenDoc, onSavePage, contextDoc }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, thinking, open]);

  const send = (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { role: 'user', content: text };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setThinking(true);
    setTimeout(() => {
      const reply = CANNED_REPLIES.find((r) => r.match.test(text)) || DEFAULT_REPLY;
      setMessages((m) => [...m, { role: 'assistant', question: text, content: reply.text, cites: reply.cites }]);
      setThinking(false);
    }, 900 + Math.random() * 500);
  };

  // Listen for ask prompts from elsewhere in the app
  useEffect(() => {
    const onAsk = (e: Event) => {
      if (open) send((e as CustomEvent<string>).detail);
    };
    window.addEventListener('wikillm:ask', onAsk);
    return () => window.removeEventListener('wikillm:ask', onAsk);
  }, [open]);

  const saveAsPage = (msg: Message) => {
    const title = msg.question
      ? msg.question.replace(/\?$/, '').slice(0, 60)
      : 'Saved answer';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    onSavePage({
      title,
      path: `personal / saved / ${slug}.md`,
      s3: `s3://wikillm/tenants/acme/users/u-1042/wiki/saved/${slug}.md`,
      source: 'personal',
      updated: 'just now',
      author: 'you · via assistant',
      tags: ['saved', 'ai-generated'],
      checksum: 'sha256:gen-' + Math.random().toString(16).slice(2, 6) + '…' + Math.random().toString(16).slice(2, 6),
      generated: true,
      question: msg.question || '',
      answer: msg.content,
      cites: msg.cites || [],
    });
  };

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
        <span className="scope-name">{contextDoc ? `this doc + shared` : 'shared + my wiki'}</span>
        <span style={{ flex: 1 }}></span>
        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>permission-filtered</span>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {messages.map((m, i) => (
          <div key={i} className={'msg ' + m.role}>
            <div className="bubble">{m.content}</div>
            {m.cites && m.cites.length > 0 && (
              <div className="citations">
                {m.cites.map((c, j) => (
                  <button key={j} className="citation" onClick={() => c.id && onOpenDoc(c.id)}>
                    <span className="num">{j + 1}</span>
                    <span className="ctitle">{c.title} <span style={{ color: 'var(--fg-3)' }}>· {c.section}</span></span>
                  </button>
                ))}
              </div>
            )}
            {m.role === 'assistant' && i > 0 && m.cites && m.cites.length > 0 && (
              <div className="msg-actions">
                <button className="msg-action primary" onClick={() => saveAsPage(m)}>
                  {ICONS.plus} Save as page in My wiki
                </button>
                <button className="msg-action">{ICONS.copy} Copy</button>
                <span style={{ flex: 1 }}></span>
                <span className="msg-meta">grounded in {m.cites.length} source{m.cites.length > 1 ? 's' : ''}</span>
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
          <textarea value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
                    }}
                    placeholder="Ask about anything in your docs…"
                    rows={1}/>
          <div className="chat-input-actions">
            <button className="btn ghost icon-only" title="Attach context">{ICONS.attach}</button>
            <span style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{contextDoc ? 'context: current doc' : 'context: all wikis'}</span>
            <span className="grow"></span>
            <button className="btn primary" onClick={() => send(input)} disabled={!input.trim()}>
              {ICONS.send} Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
