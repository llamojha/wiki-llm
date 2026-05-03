'use client';

import { useState } from 'react';
import type { AuthoredDoc, BodyKey } from '@/lib/mock/data';

type TocItem = { id: string; label: string; h3?: boolean };

const TOC_BY_BODY: Record<BodyKey, TocItem[]> = {
  incident: [
    { id: 'sec-1', label: '1. Detection & Paging' },
    { id: 'sec-2', label: '2. Initial Response' },
    { id: 'sec-2-1', label: '2.1 SEV definitions', h3: true },
    { id: 'sec-3', label: '3. Mitigation' },
    { id: 'sec-4', label: '4. Communication' },
    { id: 'sec-5', label: '5. Post-Incident Review' },
  ],
  pipeline: [
    { id: 'sec-1', label: '1. Components' },
    { id: 'sec-2', label: '2. Ingestion contract' },
    { id: 'sec-3', label: '3. Indexing' },
    { id: 'sec-3-1', label: '3.1 Reindexing', h3: true },
    { id: 'sec-4', label: '4. Failure modes' },
  ],
  billing: [
    { id: 'sec-1', label: '1. Responsibilities' },
    { id: 'sec-2', label: '2. Idempotency' },
    { id: 'sec-3', label: '3. Webhooks' },
    { id: 'sec-4', label: '4. Usage metering' },
  ],
  planning: [
    { id: 'sec-1', label: 'Top three' },
    { id: 'sec-2', label: 'Push back on' },
    { id: 'sec-3', label: 'Open questions' },
  ],
};

type TocProps = { doc: AuthoredDoc };

export function TOC({ doc }: TocProps) {
  const items = TOC_BY_BODY[doc.body] || [];
  const [active, setActive] = useState<string | undefined>(items[0]?.id);
  return (
    <aside className="toc">
      <div className="toc-title">On this page</div>
      {items.map(it => (
        <a key={it.id} href={`#${it.id}`}
           className={(it.h3 ? 'h3 ' : '') + (active === it.id ? 'active' : '')}
           onClick={() => { setActive(it.id); }}>
          {it.label}
        </a>
      ))}
      <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
        <div>updated <span style={{ color: 'var(--fg-2)' }}>{doc.updated}</span></div>
        <div>by <span style={{ color: 'var(--fg-2)' }}>{doc.author}</span></div>
        <div style={{ marginTop: 4 }}>{doc.checksum}</div>
      </div>
    </aside>
  );
}
