import { Fragment } from 'react';
import { ICONS } from '@/lib/icons';
import type { Doc } from '@/lib/mock/data';

type DocToolbarProps = {
  doc: Doc;
  onAskInChat: () => void;
  onEdit: () => void;
};

export function DocToolbar({ doc, onAskInChat, onEdit }: DocToolbarProps) {
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
      <button className="btn ghost icon-only" title="Star">{ICONS.star}</button>
      <button className="btn ghost icon-only" title="Share">{ICONS.share}</button>
      <button className="btn" onClick={onEdit}>{ICONS.edit} Edit</button>
      <button className="btn primary" onClick={onAskInChat}>{ICONS.spark} Ask</button>
      <button className="btn ghost icon-only" title="More">{ICONS.more}</button>
    </div>
  );
}
