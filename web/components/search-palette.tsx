'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ICONS } from '@/lib/icons';
import { SEARCH_INDEX, type SearchHit } from '@/lib/mock/data';

type SearchScope = 'all' | 'shared' | 'personal';

type SearchPaletteProps = {
  open: boolean;
  onClose: () => void;
  onOpenDoc: (id: string) => void;
};

type ScoredHit = SearchHit & { _score?: number };

export function SearchPalette({ open, onClose, onOpenDoc }: SearchPaletteProps) {
  const [q, setQ] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered: ScoredHit[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    let pool: SearchHit[] = SEARCH_INDEX.slice();
    if (searchScope === 'shared') pool = pool.filter((r) => r.source !== 'personal');
    if (searchScope === 'personal') pool = pool.filter((r) => r.source === 'personal');
    if (!term) return pool.slice().sort((a, b) => b.score - a.score);
    return pool
      .map((r) => {
        const hay = (r.title + ' ' + r.snippet + ' ' + r.path).toLowerCase();
        const hit = hay.includes(term);
        const titleHit = r.title.toLowerCase().includes(term);
        const score = (titleHit ? 1.5 : 0) + (hit ? r.score : 0);
        return { ...r, _score: score };
      })
      .filter((r) => (r._score ?? 0) > 0)
      .sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
  }, [q, searchScope]);

  useEffect(() => {
    setSel(0);
  }, [q, searchScope]);

  const counts = useMemo(
    () => ({
      all: SEARCH_INDEX.length,
      shared: SEARCH_INDEX.filter((r) => r.source !== 'personal').length,
      personal: SEARCH_INDEX.filter((r) => r.source === 'personal').length,
    }),
    [],
  );

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = filtered[sel];
      if (r) {
        onOpenDoc(r.id);
        onClose();
      }
    }
    if (e.key === 'Escape') onClose();
  };

  if (!open) return null;

  const highlight = (text: string): ReactNode => {
    if (!q.trim()) return text;
    const re = new RegExp(`(${q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.split(re).map((part, i) =>
      re.test(part) ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>,
    );
  };

  const scopeOptions: Array<[SearchScope, string, number]> = [
    ['all', 'All', counts.all],
    ['shared', 'Shared', counts.shared],
    ['personal', 'My wiki', counts.personal],
  ];

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          {ICONS.search}
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                 onKeyDown={onKey}
                 placeholder="Search across shared and personal docs…"/>
          <span className="kbd">esc</span>
        </div>
        <div className="palette-scope">
          {scopeOptions.map(([k, label, c]) => (
            <button key={k} className={searchScope === k ? 'on' : ''}
                    onClick={() => setSearchScope(k)}>
              {label}<span className="count">{c}</span>
            </button>
          ))}
        </div>
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">
              No results for <code>{q}</code>.<br/>
              <span className="ghost-key">Try a broader term or switch scope.</span>
            </div>
          ) : filtered.map((r, i) => (
            <div key={r.id}
                 className={'palette-row' + (i === sel ? ' sel' : '')}
                 onMouseEnter={() => setSel(i)}
                 onClick={() => { onOpenDoc(r.id); onClose(); }}>
              <span className="res-icon">{ICONS.doc}</span>
              <div>
                <div className="res-title">{highlight(r.title)}</div>
                <div className="res-snippet">{highlight(r.snippet)}</div>
              </div>
              <div className="res-meta">
                <span>{r.path}</span>
                <span>{r.updated}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span className="kbd">↑↓</span><span>navigate</span>
          <span className="kbd">⏎</span><span>open</span>
          <span className="grow"></span>
          <span>{filtered.length} results · permission-filtered</span>
        </div>
      </div>
    </div>
  );
}
