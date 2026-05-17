// WikiLLM main React app

const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { ICONS, SHARED_TREE, PERSONAL_TREE, DOCS, SEARCH_INDEX } = window.WIKI_DATA;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accentHue": 252,
  "density": "comfy",
  "readerWidth": "default",
  "showChat": true
}/*EDITMODE-END*/;

// ───── Sidebar tree ─────
function TreeNode({ node, depth, activeId, onOpen, openFolders, toggleFolder }) {
  if (node.type === 'folder') {
    const isOpen = openFolders.has(node.id);
    return (
      <div className="tree-row">
        <button className="nav-row" onClick={() => toggleFolder(node.id)} style={{ paddingLeft: 6 }}>
          <span className={"tree-toggle" + (isOpen ? ' open' : '')}>
            {ICONS.chev}
          </span>
          <span className="nav-icon">{ICONS.folder}</span>
          <span className="nav-label">{node.name}</span>
        </button>
        {isOpen && (
          <div className="tree-children">
            {node.children.map(c => (
              <TreeNode key={c.id} node={c} depth={depth+1}
                        activeId={activeId} onOpen={onOpen}
                        openFolders={openFolders} toggleFolder={toggleFolder}/>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <button className={"nav-row" + (activeId === node.id ? ' active' : '')}
            onClick={() => onOpen(node.id)}
            style={{ paddingLeft: 22 }}>
      <span className="nav-icon">{ICONS.doc}</span>
      <span className="nav-label">{node.name}</span>
      {node.tag === 'generated' && <span className="nav-meta" title="auto-generated">AI</span>}
    </button>
  );
}

function Sidebar({ scope, setScope, activeId, onOpen, onNewPage, onUpload, onProcessPending, onReindex }) {
  const tree = scope === 'shared' ? SHARED_TREE : PERSONAL_TREE;
  const [openFolders, setOpenFolders] = useState(new Set([
    'platform', 'platform/runbooks', 'engineering', 'engineering/services',
    'me/notes', 'me/learning'
  ]));
  const toggleFolder = (id) => {
    setOpenFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  return (
    <aside className="sidebar">
      <div className="scope-switch">
        <button className={scope === 'shared' ? 'on' : ''} onClick={() => setScope('shared')}>
          {ICONS.globe} Shared
        </button>
        <button className={scope === 'personal' ? 'on' : ''} onClick={() => setScope('personal')}>
          {ICONS.lock} My wiki
        </button>
      </div>

      <button className={"nav-row" + (activeId === '__home' ? ' active' : '')} onClick={() => onOpen('__home')}>
        <span className="nav-icon">{ICONS.home}</span>
        <span className="nav-label">Home</span>
      </button>
      <button className="nav-row" onClick={() => onOpen('__recent')}>
        <span className="nav-icon">{ICONS.recent}</span>
        <span className="nav-label">Recent</span>
      </button>
      <button className="nav-row" onClick={() => onOpen('__starred')}>
        <span className="nav-icon">{ICONS.star}</span>
        <span className="nav-label">Starred</span>
        <span className="nav-meta">7</span>
      </button>

      <div className="nav-section">
        <span>{scope === 'shared' ? 'Shared spaces' : 'My pages'}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={onUpload} title="Upload Markdown files">{ICONS.upload}</button>
          <button onClick={onNewPage} title="New page">{ICONS.plus}</button>
        </div>
      </div>

      {tree.map(n => (
        <TreeNode key={n.id} node={n} depth={0}
                  activeId={activeId} onOpen={onOpen}
                  openFolders={openFolders} toggleFolder={toggleFolder}/>
      ))}

      <div className="index-card">
        <div className="index-card-row">
          <span className="pulse"></span>
          <div style={{ flex: 1, lineHeight: 1.3 }}>
            <div style={{ color: 'var(--fg-1)', fontWeight: 500 }}>Indexer healthy</div>
            <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>
              1,284 indexed
              <span style={{ color: 'var(--fg-3)', margin: '0 4px' }}>·</span>
              <span className="pending-pip">47 pending</span>
            </div>
          </div>
        </div>
        <div className="index-card-actions">
          <button className="index-card-btn" onClick={onProcessPending} title="Curate raw files in S3">
            {ICONS.spark} Process pending
          </button>
          <button className="index-card-btn" onClick={onReindex} title="Re-index everything">
            {ICONS.recent} Re-index
          </button>
        </div>
      </div>
    </aside>
  );
}

// ───── Top bar ─────
function TopBar({ onSearch, onToggleChat, chatOpen, theme, setTheme }) {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark">w</div>
        <div className="brand-name">WikiLLM <span>/ knowledge</span></div>
        <span className="tenant-pill">acme</span>
      </div>
      <div className="topbar-search">
        <button className="search-trigger" onClick={onSearch}>
          {ICONS.search}
          <span>Search docs, runbooks, people…</span>
          <span className="kbd">⌘K</span>
        </button>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" title="Toggle theme"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? ICONS.sun : ICONS.moon}
        </button>
        <button className="icon-btn" title="Notifications">
          {ICONS.bell}
          <span className="dot"></span>
        </button>
        <button className={"ask-btn" + (chatOpen ? ' active' : '')}
                onClick={onToggleChat} title="Ask the wiki">
          {ICONS.spark}
          <span>Ask the wiki</span>
          <span className="kbd-inv">⌘⇧A</span>
        </button>
        <div className="avatar" title="hello@acme.io">YO</div>
      </div>
    </div>
  );
}

// ───── Doc reader ─────
function DocToolbar({ doc, onAskInChat, onEdit }) {
  const sourceTag = doc.source === 'shared'
    ? <span className="tag-chip shared">{ICONS.globe} shared</span>
    : doc.source === 'personal'
      ? <span className="tag-chip personal">{ICONS.lock} private</span>
      : <span className="tag-chip generated">{ICONS.spark} generated</span>;
  return (
    <div className="doc-toolbar">
      <div className="crumbs">
        {doc.path.split(' / ').map((p, i, a) => (
          <React.Fragment key={i}>
            <span className={"crumb" + (i === a.length-1 ? ' current' : '')}>{p}</span>
            {i < a.length-1 && <span className="sep">/</span>}
          </React.Fragment>
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

function TOC({ doc }) {
  // Pull headings from the doc body type
  const tocByBody = {
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
  const items = tocByBody[doc.body] || [];
  const [active, setActive] = useState(items[0]?.id);
  return (
    <aside className="toc">
      <div className="toc-title">On this page</div>
      {items.map(it => (
        <a key={it.id} href={`#${it.id}`}
           className={(it.h3 ? 'h3 ' : '') + (active === it.id ? 'active' : '')}
           onClick={(e) => { setActive(it.id); }}>
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

function GeneratedDocReader({ doc, onEdit }) {
  return <>
    <div className="doc-toolbar">
      <div className="crumbs">
        {doc.path.split(' / ').map((p, i, a) => (
          <React.Fragment key={i}>
            <span className={"crumb" + (i === a.length-1 ? ' current' : '')}>{p}</span>
            {i < a.length-1 && <span className="sep">/</span>}
          </React.Fragment>
        ))}
      </div>
      <span className="tag-chip personal">{ICONS.lock} private</span>
      <span className="tag-chip generated">{ICONS.spark} generated</span>
      <button className="btn ghost icon-only" title="Star">{ICONS.star}</button>
      <button className="btn" onClick={onEdit}>{ICONS.edit} Edit</button>
      <button className="btn">{ICONS.share} Share</button>
    </div>
    <div className="doc-wrap">
      <article className="doc">
        <div className="gen-hero">
          <div className="gen-hero-eyebrow">
            <span className="gen-hero-icon">{ICONS.spark}</span>
            <span>Generated by Ask the wiki</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--fg-3)', display: 'inline-block' }}></span>
            <span>{doc.updated}</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--fg-3)', display: 'inline-block' }}></span>
            <span>{doc.cites?.length || 0} source{(doc.cites?.length || 0) === 1 ? '' : 's'}</span>
          </div>
          <h1 className="gen-hero-q">{doc.question}</h1>
        </div>

        <div className="gen-section">
          <div className="gen-section-label">Answer</div>
          <div className="gen-answer">{doc.answer}</div>
        </div>

        {doc.cites && doc.cites.length > 0 && (
          <div className="gen-section">
            <div className="gen-section-label">Sources</div>
            <div className="gen-sources">
              {doc.cites.map((c, i) => (
                <div key={i} className="gen-source">
                  <span className="gen-source-num">{i+1}</span>
                  <div style={{ flex: 1 }}>
                    <div className="gen-source-title">{c.title}</div>
                    <div className="gen-source-section">{c.section}</div>
                  </div>
                  <span style={{ color: 'var(--fg-3)' }}>{ICONS.arrow}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="gen-section">
          <div className="gen-section-label">Notes</div>
          <p style={{ color: 'var(--fg-2)', fontStyle: 'italic', margin: '4px 0 8px' }}>Add your own notes — they stay private to you.</p>
          <div className="gen-notes-placeholder">Click to add a note…</div>
        </div>

        <div className="callout info" style={{ marginTop: 24 }}>
          <span className="icon">{ICONS.info}</span>
          <div>This page was generated from a chat answer. The original sources are linked above. If a source changes, this page <strong>does not</strong> update automatically — re-run the question to refresh.</div>
        </div>
      </article>
      <aside className="toc">
        <div className="toc-title">Page</div>
        <a href="#" className="active">Answer</a>
        <a href="#">Sources</a>
        <a href="#">Notes</a>
        <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
          <div>type <span style={{ color: 'var(--fg-2)' }}>generated</span></div>
          <div>updated <span style={{ color: 'var(--fg-2)' }}>{doc.updated}</span></div>
          <div>visibility <span style={{ color: 'var(--fg-2)' }}>private</span></div>
          <div style={{ marginTop: 4 }}>{doc.checksum}</div>
        </div>
      </aside>
    </div>
  </>;
}

function DocReader({ doc, onAskInChat, onEdit }) {
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
        {React.createElement(window.DocBody, { which: doc.body })}
      </article>
      <TOC doc={doc}/>
    </div>
  </>;
}

// ───── Search palette ─────
function SearchPalette({ open, onClose, onOpenDoc, scope }) {
  const [q, setQ] = useState('');
  const [searchScope, setSearchScope] = useState('all');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ(''); setSel(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let pool = SEARCH_INDEX.slice();
    if (searchScope === 'shared') pool = pool.filter(r => r.source !== 'personal');
    if (searchScope === 'personal') pool = pool.filter(r => r.source === 'personal');
    if (!term) return pool.slice().sort((a,b) => b.score - a.score);
    return pool
      .map(r => {
        const hay = (r.title + ' ' + r.snippet + ' ' + r.path).toLowerCase();
        const hit = hay.includes(term);
        const titleHit = r.title.toLowerCase().includes(term);
        const score = (titleHit ? 1.5 : 0) + (hit ? r.score : 0);
        return { ...r, _score: score };
      })
      .filter(r => r._score > 0)
      .sort((a,b) => b._score - a._score);
  }, [q, searchScope]);

  useEffect(() => { setSel(0); }, [q, searchScope]);

  const counts = useMemo(() => ({
    all: SEARCH_INDEX.length,
    shared: SEARCH_INDEX.filter(r => r.source !== 'personal').length,
    personal: SEARCH_INDEX.filter(r => r.source === 'personal').length,
  }), []);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = filtered[sel];
      if (r) { onOpenDoc(r.id); onClose(); }
    }
    if (e.key === 'Escape') onClose();
  };

  if (!open) return null;

  const highlight = (text) => {
    if (!q.trim()) return text;
    const re = new RegExp(`(${q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.split(re).map((part, i) =>
      re.test(part) ? <mark key={i}>{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>
    );
  };

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
          {[
            ['all', 'All', counts.all],
            ['shared', 'Shared', counts.shared],
            ['personal', 'My wiki', counts.personal],
          ].map(([k, label, c]) => (
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
                 className={"palette-row" + (i === sel ? ' sel' : '')}
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

// ───── Markdown editor ─────
function Editor({ doc, onClose, onSave }) {
  const [title, setTitle] = useState(doc?.title || 'Untitled');
  const initialBody = doc?.generated
    ? `# ${doc.title}\n\n> _Originally generated by Ask the wiki on ${doc.updated}._\n\n## Question\n\n${doc.question || ''}\n\n## Answer\n\n${doc.answer || ''}\n\n## Sources\n\n${(doc.cites || []).map((c, i) => `${i+1}. **${c.title}** — _${c.section}_`).join('\n')}\n\n## My notes\n\n_Add your own notes here…_\n`
    : `# ${doc?.title || 'Untitled'}\n\nStart writing your notes here. This page is **private** by default — only you can see it until you move it to a shared space.\n\n## Section\n\n- bullet\n- bullet\n- bullet\n\n\`\`\`bash\n# Some code\necho "hello"\n\`\`\`\n`;
  const [body, setBody] = useState(initialBody);
  return (
    <>
      <div className="doc-toolbar">
        <div className="crumbs">
          <span className="crumb">personal</span>
          <span className="sep">/</span>
          <span className="crumb">notes</span>
          <span className="sep">/</span>
          <span className="crumb current">{title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md</span>
        </div>
        <span className="tag-chip personal">{ICONS.lock} private · draft</span>
        <span style={{ color: 'var(--fg-3)', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>autosaved 2s ago</span>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onSave(title, body)}>{ICONS.check} Save</button>
      </div>
      <div className="editor-wrap" style={{ flex: 1, minHeight: 0 }}>
        <div className="editor">
          <input className="editor-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled"/>
          <div style={{ color: 'var(--fg-3)', fontSize: 11, fontFamily: 'var(--font-mono)', marginBottom: 18 }}>
            s3://wikillm/tenants/acme/users/u-1042/wiki/notes/{title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md
          </div>
          <textarea className="editor-input" value={body}
                    onChange={(e) => setBody(e.target.value)}
                    spellCheck={false}/>
        </div>
        <div className="preview">
          <div style={{ color: 'var(--fg-3)', fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 14 }}>Preview</div>
          <article className="doc">
            <RenderedMarkdown title={title} body={body}/>
          </article>
        </div>
      </div>
    </>
  );
}

function RenderedMarkdown({ title, body }) {
  // Tiny mock markdown renderer (handles h1/h2/h3, lists, code fences, paragraphs, **bold**)
  const lines = body.split('\n');
  const out = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++; }
      i++;
      out.push(<pre key={key++}><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    if (line.startsWith('# ')) { out.push(<h1 key={key++}>{line.slice(2)}</h1>); i++; continue; }
    if (line.startsWith('## ')) { out.push(<h2 key={key++}>{line.slice(3)}</h2>); i++; continue; }
    if (line.startsWith('### ')) { out.push(<h3 key={key++}>{line.slice(4)}</h3>); i++; continue; }
    if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(lines[i].slice(2)); i++; }
      out.push(<ul key={key++}>{items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    out.push(<p key={key++}>{renderInline(line)}</p>);
    i++;
  }
  return <>{out}</>;
}
function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

window.WIKI_APP = { Sidebar, TopBar, DocReader, SearchPalette, Editor };
