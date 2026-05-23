'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ICONS } from '@/lib/icons';

type HomeMode = 'home' | 'recent' | 'starred';

type HomeViewProps = {
  view: HomeMode;
  onOpen: (id: string) => void;
  onAsk: () => void;
  onAskPrompt: (prompt: string) => void;
  onUpload: () => void;
  prompts: string[];
  setPrompts: (next: string[]) => void;
  docCount?: number;
  wikiCount?: number;
};

type Activity = { kind: 'index' | 'gen' | 'edit' | 'share'; text: ReactNode; time: string };
type DocSummary = {
  id: string;
  title: string;
  path: string;
  source_type: string;
  updated: string;
  starred: boolean;
  snippet: string;
};

export function HomeView({ view, onOpen, onAsk, onAskPrompt, onUpload, prompts, setPrompts, docCount = 0, wikiCount = 0 }: HomeViewProps) {
  const [listedDocs, setListedDocs] = useState<DocSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const stats = [
    { label: 'Indexed docs', value: String(docCount), sub: 'in vault' },
    { label: 'You authored', value: String(wikiCount), sub: 'in authored/' },
    { label: 'Storage', value: 'S3', sub: 'source of truth' },
    { label: 'Search', value: 'Fuse.js', sub: 'in-memory' },
  ];
  const askPrompts = prompts;
  const updatePromptAt = (i: number, val: string) => {
    const next = askPrompts.slice();
    next[i] = val;
    setPrompts(next);
  };

  // Avoid SSR/CSR Date drift hydration mismatch.
  const [today, setToday] = useState<string>('');
  useEffect(() => {
    setToday(new Date().toDateString());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const listView = view === 'starred' ? 'starred' : 'recent';
    setListLoading(true);
    fetch(`/api/docs?view=${listView}&limit=12`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : [])
      .then((docs: DocSummary[]) => setListedDocs(docs))
      .catch(() => {
        if (!controller.signal.aborted) setListedDocs([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [view]);

  const activity: Activity[] = [];
  const listTitle = view === 'starred' ? 'Starred' : 'Continue reading';

  return <>
    <div className="doc-toolbar">
      <div className="crumbs">
        <span className="crumb current">Home</span>
      </div>
      <span className="tag-chip">vaultmark</span>
      <span style={{ flex: 1 }}></span>
      <span style={{ color: 'var(--fg-3)', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>{today}</span>
    </div>
    <div style={{ padding: '32px 28px 60px', maxWidth: 1180, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>{today || '\u00A0'}</div>
        <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.018em', margin: 0, color: 'var(--fg)' }}>Welcome back.</h1>
        <p style={{ color: 'var(--fg-2)', fontSize: 14, marginTop: 6 }}>{docCount} documents indexed and ready.</p>
      </div>

      {/* Hero ask-the-wiki card */}
      <div className="ask-hero">
        <div className="ask-hero-bg"></div>
        <div className="ask-hero-inner">
          <div className="ask-hero-eyebrow">
            <span className="ask-hero-spark">{ICONS.spark}</span>
            <span>Ask the wiki</span>
            <span className="ask-hero-beta">MVP 2 · beta</span>
          </div>
          <h2 className="ask-hero-title">Get an answer grounded in your team's docs.</h2>
          <p className="ask-hero-sub">Cited, permission-filtered, and ready to save as a page in your personal wiki.</p>
          <button className="ask-hero-input" onClick={() => onAsk()}>
            <span style={{ color: 'var(--accent)' }}>{ICONS.spark}</span>
            <span style={{ color: 'var(--fg-3)' }}>Ask anything about runbooks, services, or your notes…</span>
            <span className="kbd" style={{ marginLeft: 'auto' }}>⌘⇧A</span>
          </button>
          <div className="ask-hero-secondary">
            <button className="ask-hero-secondary-btn" onClick={onUpload}>
              {ICONS.upload}
              <div>
                <div className="ash-title">Upload Markdown</div>
                <div className="ash-sub">Drop .md files — indexed in seconds</div>
              </div>
            </button>
            <button className="ask-hero-secondary-btn" onClick={() => onAskPrompt('Create a wiki page about our deployment process')}>
              {ICONS.spark}
              <div>
                <div className="ash-title">Generate a page</div>
                <div className="ash-sub">Start from a prompt, edit after</div>
              </div>
            </button>
          </div>
          <div className="ask-hero-prompts">
            {askPrompts.map((p, i) => {
              const isCreate = /^create a wiki page/i.test(p);
              return (
                <div key={i} className={'ask-hero-chip editable' + (isCreate ? ' create' : '')}>
                  {isCreate && <span className="ask-hero-chip-icon">{ICONS.plus}</span>}
                  <span
                    className="ask-hero-chip-text"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onBlur={(e) => updatePromptAt(i, (e.currentTarget.textContent || '').trim() || p)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                  >{p}</span>
                  <button
                    className="ask-hero-chip-go"
                    title={isCreate ? 'Generate page' : 'Ask'}
                    onClick={() => onAskPrompt(p)}
                  >{isCreate ? ICONS.spark : ICONS.arrow}</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 36 }}>
        {stats.map(s => (
          <div key={s.label} style={{
            border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px',
            background: 'var(--bg-1)'
          }}>
            <div style={{ fontSize: 11, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>{s.value}</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
        <section>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-2)', margin: '0 0 12px' }}>{listTitle}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-1)' }}>
            {listLoading && (
              <div style={{ padding: '14px 16px', color: 'var(--fg-3)', fontSize: 12 }}>Loading…</div>
            )}
            {!listLoading && listedDocs.length === 0 && (
              <div style={{ padding: '14px 16px', color: 'var(--fg-3)', fontSize: 12 }}>
                {view === 'starred' ? 'No starred documents yet.' : 'No recent documents found.'}
              </div>
            )}
            {!listLoading && listedDocs.map(d => (
              <button key={d.id} onClick={() => onOpen(d.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 12, alignItems: 'center',
                  padding: '14px 16px', border: 0, background: 'transparent', textAlign: 'left',
                  borderBottom: '1px solid var(--line)',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <span style={{ color: 'var(--fg-3)' }}>{ICONS.doc}</span>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{d.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{d.path}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {d.source_type === 'generated' && <span className="tag-chip generated">generated</span>}
                  {d.source_type === 'personal' && <span className="tag-chip personal">private</span>}
                  {d.source_type === 'authored' && <span className="tag-chip shared">shared</span>}
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{d.updated}</span>
                  <span style={{ color: 'var(--fg-3)' }}>{ICONS.arrow}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-2)', margin: '0 0 12px' }}>Activity</h2>
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, background: 'var(--bg-1)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activity.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12.5, color: 'var(--fg-1)' }}>
                <span style={{
                  width: 6, height: 6, marginTop: 7, borderRadius: '50%', flexShrink: 0,
                  background: a.kind === 'gen' ? 'var(--accent)' : a.kind === 'index' ? 'var(--green)' : 'var(--fg-3)',
                }}></span>
                <div style={{ flex: 1 }}>
                  <div>{a.text}</div>
                  <div style={{ color: 'var(--fg-3)', fontSize: 10.5, fontFamily: 'var(--font-mono)', marginTop: 2 }}>{a.time}</div>
                </div>
              </div>
            ))}
          </div>

          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-2)', margin: '24px 0 12px' }}>Try asking</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {askPrompts.map(q => (
              <button key={q} className="btn ghost" onClick={() => onAskPrompt(q)} style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 10px', fontWeight: 400, color: 'var(--fg-1)' }}>
                <span style={{ color: 'var(--accent)' }}>{ICONS.spark}</span>
                <span style={{ textAlign: 'left' }}>{q}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  </>;
}
