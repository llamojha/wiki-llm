'use client';

import { Fragment, useEffect, useState } from 'react';
import { ICONS } from '@/lib/icons';
import type { Doc, LiveDoc } from '@/lib/types';

type DocToolbarProps = {
  doc: Doc;
  docId?: string;
  onAskInChat: () => void;
  onEdit: () => void;
  onStarToggle?: (starred: boolean, etag: string) => void;
};

function isLiveDoc(doc: Doc): doc is LiveDoc {
  return !doc.generated && 'kind' in doc;
}

export function DocToolbar({ doc, docId, onAskInChat, onEdit, onStarToggle }: DocToolbarProps) {
  const live = isLiveDoc(doc) ? doc : null;
  const [starred, setStarred] = useState(live?.starred ?? false);

  useEffect(() => {
    setStarred(live?.starred ?? false);
  }, [docId, live?.starred]);

  const toggleStar = async () => {
    if (!docId) return;
    const prev = starred;
    setStarred(!prev);
    try {
      const res = await fetch(`/api/star/${encodeURIComponent(docId)}`, {
        method: 'PATCH',
      });
      if (res.ok) {
        const data = await res.json();
        setStarred(data.starred);
        if (onStarToggle) onStarToggle(data.starred, data.etag);
      } else {
        setStarred(prev);
      }
    } catch {
      setStarred(prev);
    }
  };

  const sourceTag = doc.source === 'shared'
    ? <span className="tag-chip shared">{ICONS.globe} shared</span>
    : doc.source === 'personal'
      ? <span className="tag-chip personal">{ICONS.lock} private</span>
      : <span className="tag-chip generated">{ICONS.spark} generated</span>;

  return (
    <div className="doc-toolbar">
      <div className="crumbs">
        {doc.path.split(' / ').map((p, i, a) => (
          <Fragment key={i}>
            <span className={'crumb' + (i === a.length - 1 ? ' current' : '')}>{p}</span>
            {i < a.length - 1 && <span className="sep">/</span>}
          </Fragment>
        ))}
      </div>
      {sourceTag}
      <button
        className={'btn ghost icon-only' + (starred ? ' starred' : '')}
        title={starred ? 'Unstar' : 'Star'}
        onClick={toggleStar}
        style={starred ? { color: 'var(--accent)' } : undefined}
      >{ICONS.star}</button>
      <button className="btn ghost icon-only" title="Share">{ICONS.share}</button>
      <button className="btn" onClick={onEdit}>{ICONS.edit} Edit</button>
      <button className="btn primary" onClick={onAskInChat}>{ICONS.spark} Ask</button>
      <button className="btn ghost icon-only" title="More">{ICONS.more}</button>
    </div>
  );
}
