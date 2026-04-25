'use client';

import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { search as apiSearch, type ApiSearchResult } from '@/lib/api';
import { ICONS } from '@/lib/icons';
import { DEFAULT_USER_ID } from '@/lib/vault-paths';
import type { Scope } from '@/lib/types';

type SearchPaletteProps = {
  open: boolean;
  onClose: () => void;
  onOpenDoc: (id: string) => void;
  scope: Scope;
};

export function SearchPalette({ open, onClose, onOpenDoc, scope }: SearchPaletteProps) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ApiSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setResults([]);
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = q.trim();
    if (!term) { setResults([]); return; }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      apiSearch(term, {
        scope,
        ...(scope === 'user' ? { userId: DEFAULT_USER_ID } : {}),
      })
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  useEffect(() => { setSel(0); }, [q]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[sel];
      if (r) { onOpenDoc(r.id); onClose(); }
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

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          {ICONS.search}
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                 onKeyDown={onKey}
                 placeholder="Search across your vault…"/>
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list">
          {loading && <div className="palette-empty">Searching…</div>}
          {!loading && q.trim() && results.length === 0 && (
            <div className="palette-empty">
              No results for <code>{q}</code>.
            </div>
          )}
          {!loading && results.map((r, i) => (
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
              </div>
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span className="kbd">↑↓</span><span>navigate</span>
          <span className="kbd">⏎</span><span>open</span>
          <span className="grow"></span>
          {results.length > 0 && <span>{results.length} results</span>}
        </div>
      </div>
    </div>
  );
}
