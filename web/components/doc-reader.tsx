import { ICONS } from '@/lib/icons';
import { DocBody } from '@/lib/mock/doc-bodies';
import type { Doc } from '@/lib/mock/data';
import { DocToolbar } from './doc-toolbar';
import { GeneratedDocReader } from './generated-doc-reader';
import { TOC } from './toc';

type DocReaderProps = {
  doc: Doc;
  onAskInChat: () => void;
  onEdit: () => void;
};

export function DocReader({ doc, onAskInChat, onEdit }: DocReaderProps) {
  if (doc.generated) {
    return <GeneratedDocReader doc={doc} onEdit={onEdit}/>;
  }
  return <>
    <DocToolbar doc={doc} onAskInChat={onAskInChat} onEdit={onEdit}/>
    <div className="doc-wrap">
      <article className="doc">
        <div className="doc-meta">
          <span>{doc.path.split(' / ').slice(0, -1).join(' / ')}</span>
          <span className="dot"></span>
          <span>updated {doc.updated}</span>
          <span className="dot"></span>
          <span>by {doc.author}</span>
          <span className="dot"></span>
          <span>{doc.checksum}</span>
        </div>
        <h1>{doc.title}</h1>
        <div style={{ display: 'flex', gap: 5, marginBottom: 18, flexWrap: 'wrap' }}>
          {doc.tags.map(t => <span key={t} className="tag-chip">{ICONS.tag} {t}</span>)}
        </div>
        <DocBody which={doc.body}/>
      </article>
      <TOC doc={doc}/>
    </div>
  </>;
}
