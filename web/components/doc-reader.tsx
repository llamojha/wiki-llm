import { ICONS } from '@/lib/icons';
import { DocBody } from '@/lib/mock/doc-bodies';
import type { AuthoredDoc, Doc, LiveDoc } from '@/lib/mock/data';
import { DocToolbar } from './doc-toolbar';
import { GeneratedDocReader } from './generated-doc-reader';
import { TOC } from './toc';

type DocReaderProps = {
  doc: Doc;
  onAskInChat: () => void;
  onEdit: () => void;
};

function isLiveDoc(doc: Doc): doc is LiveDoc {
  // LiveDoc carries kind:'live'; AuthoredDoc does not have a kind field.
  return !doc.generated && 'kind' in doc;
}

export function DocReader({ doc, onAskInChat, onEdit }: DocReaderProps) {
  if (doc.generated) {
    return <GeneratedDocReader doc={doc} onEdit={onEdit}/>;
  }
  // At this point doc is AuthoredDoc | LiveDoc
  const liveDoc = isLiveDoc(doc) ? doc : null;
  // Safe: if not a LiveDoc, it must be AuthoredDoc (GeneratedDoc already returned above)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authoredDoc = liveDoc ? null : (doc as any as AuthoredDoc);

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
        {liveDoc
          /* _html is always the output of renderMarkdown() — sanitized by rehype-sanitize */
          ? <div className="doc-body" dangerouslySetInnerHTML={{ __html: liveDoc._html }} />
          : authoredDoc ? <DocBody which={authoredDoc.body}/> : null
        }
      </article>
      <TOC doc={doc}/>
    </div>
  </>;
}
