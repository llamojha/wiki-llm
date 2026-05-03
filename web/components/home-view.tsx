'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ICONS } from '@/lib/icons';
import { DOCS, type AuthoredDoc } from '@/lib/mock/data';

type HomeViewProps = {
  onOpen: (id: string) => void;
  onAsk: () => void;
  onAskPrompt: (prompt: string, opts?: { createPage?: boolean }) => void;
  prompts: string[];
  setPrompts: (next: string[]) => void;
};

type Activity = { kind: 'index' | 'gen' | 'edit' | 'share'; text: ReactNode; time: string };

export function HomeView({ onOpen, onAsk, onAskPrompt, prompts, setPrompts }: HomeViewProps) {
  const recentDocs = (['doc-prod-incident', 'doc-data-pipeline', 'doc-billing-svc', 'doc-me-q2-planning'] as const)
    .map((id) => ({ id, ...(DOCS[id] as AuthoredDoc) }));
  const stats = [
    { label: 'Indexed docs', value: '1,284', sub: 'across 3 spaces' },
    { label: 'You authored', value: '47', sub: '12 shared, 35 personal' },
    { label: 'Index lag', value: '12s', sub: 'healthy' },
    { label: 'Searches today', value: '328', sub: '+18% wow' },
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

  const activity: Activity[] = [
    { kind: 'index', text: <>Indexed <strong>3 new docs</strong> from <code>release-notes</code> pipeline</>, time: '12s ago' },
    { kind: 'gen', text: <><strong>Search outage 04-19</strong> postmortem auto-generated</>, time: '2h ago' },
    { kind: 'edit', text: <>You edited <strong>q2-planning.md</strong></>, time: '1d ago' },
    { kind: 'share', text: <><strong>m.chen</strong> shared <code>billing-service.md</code></>, time: '3d ago' },
  ];

  return <>
    <div className="doc-toolbar">
      <div className="crumbs">
        <span className="crumb current">Home</span>
      </div>
      <span className="tag-chip">tenant: acme</span>
      <span style={{ flex: 1 }}></span>
      <span style={{ color: 'var(--fg-3)', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>{today}</span>
    </div>
    <div style={{ padding: '32px 28px 60px', maxWidth: 1180, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>Wednesday afternoon, you</div>
        <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.018em', margin: 0, color: 'var(--fg)' }}>Welcome back.</h1>
        <p style={{ color: 'var(--fg-2)', fontSize: 14, marginTop: 6 }}>1,284 documents are indexed and ready. Three new runbooks landed since yesterday.</p>
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
                    onClick={() => onAskPrompt(p, { createPage: isCreate })}
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
          <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-2)', margin: '0 0 12px' }}>Continue reading</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-1)' }}>
            {recentDocs.map(d => (
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
                  {d.source === 'shared' && <span className="tag-chip shared">shared</span>}
                  {d.source === 'personal' && <span className="tag-chip personal">private</span>}
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
