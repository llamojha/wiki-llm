import { ICONS } from '@/lib/icons';
import type { Doc, LiveDoc } from '@/lib/types';
import { DocToolbar } from './doc-toolbar';
import { GeneratedDocReader } from './generated-doc-reader';
import { TOC } from './toc';

type DocReaderProps = {
  doc: Doc;
  docId?: string;
  onAskInChat: () => void;
  onEdit: () => void;
};

function isLiveDoc(doc: Doc): doc is LiveDoc {
  return !doc.generated && 'kind' in doc;
}

export function DocReader({ doc, docId, onAskInChat, onEdit }: DocReaderProps) {
  if (doc.generated) {
    return <GeneratedDocReader doc={doc} onEdit={onEdit}/>;
  }
  const liveDoc = isLiveDoc(doc) ? doc : null;

  return <>
    <DocToolbar doc={doc} docId={docId} onAskInChat={onAskInChat} onEdit={onEdit}/>
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
        {liveDoc
          ? <div className="doc-body" dangerouslySetInnerHTML={{ __html: liveDoc._html }} />
          : null
        }
      </article>
      <TOC doc={doc}/>
    </div>
  </>;
}
