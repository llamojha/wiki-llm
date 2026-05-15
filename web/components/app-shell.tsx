'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDoc, getTree, type ApiDoc, type ApiTreeNode } from '@/lib/api';
import { ICONS } from '@/lib/icons';
import { renderMarkdown } from '@/lib/markdown';
import { type Doc, type GeneratedDoc, type LiveDoc, type SanitizedHtml, type Scope } from '@/lib/types';
import { DEFAULT_THEME, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';
import { ChatFab } from './chat-fab';
import { ChatPanel } from './chat-panel';
import { DocReader } from './doc-reader';
import { Editor } from './editor';
import { HomeView } from './home-view';
import { SearchPalette } from './search-palette';
import { Sidebar } from './sidebar';
import { ToastStack } from './toast-stack';
import { TopBar } from './top-bar';
import { UploadModal, type LibraryTab } from './upload-modal';

const HOME_IDS = new Set(['__home', '__recent', '__starred']);

function countTreeDocs(nodes: ApiTreeNode[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'doc') count++;
    else if (n.type === 'folder') count += countTreeDocs(n.children);
  }
  return count;
}

const DEFAULT_PROMPTS = [
  "What's the on-call paging procedure?",
  'How does indexing handle S3 events?',
  'Summarize the billing service',
  'Create a wiki page about our deployment process',
];

const TOAST_DURATION_MS = 2200;
const ASK_EVENT = 'wikillm:ask';

function makeId(prefix: string) {
  return prefix + Date.now();
}

function shortHash() {
  return Math.random().toString(16).slice(2, 6) + '…' + Math.random().toString(16).slice(2, 6);
}

function buildGeneratedDocFromPrompt(prompt: string): { id: string; doc: GeneratedDoc } {
  const isCreate = /^create a wiki page (about|on|for) /i.test(prompt);
  const topic = isCreate
    ? prompt.replace(/^create a wiki page (about|on|for) /i, '').trim()
    : prompt.replace(/\?$/, '').trim();
  const title = topic.charAt(0).toUpperCase() + topic.slice(1);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const id = makeId('doc-me-gen-');
  const cites = [
    { title: 'Engineering handbook', section: '§ 3.2 conventions' },
    { title: 'Production runbook', section: '§ on-call' },
    { title: 'Architecture overview', section: '§ services' },
  ];
  const answer = `Here's a synthesized overview of **${title.toLowerCase()}**, drawn from the docs your team has indexed.\n\nThis page was generated from a prompt and stitches together the most relevant passages found across the wiki. Edit it freely — your changes won't affect the original sources.`;
  const doc: GeneratedDoc = {
    title,
    path: `generated / ${slug}.md`,
    s3: `generated/${slug}.md`,
    source: 'personal',
    updated: 'just now',
    author: 'you · via assistant',
    tags: ['generated', 'ai'],
    checksum: 'sha256:gen-' + shortHash(),
    generated: true,
    question: prompt,
    answer,
    cites,
  };
  return { id, doc };
}

/** Convert an API doc response into a LiveDoc for DocReader. */
function apiDocToDoc(api: ApiDoc, html: SanitizedHtml): LiveDoc {
  return {
    generated: false,
    kind: 'live',
    title: api.title,
    path: api.path,
    s3: api.s3_key,
    source: api.source_type === 'generated' ? 'generated' : 'shared',
    updated: api.updated || 'unknown',
    author: api.author || 'unknown',
    tags: api.tags,
    checksum: api.checksum,
    _html: html,
    etag: api.etag,
    starred: api.starred,
    raw_markdown: api.raw_markdown,
  };
}

type AppShellProps = {
  initialTree: ApiTreeNode[];
  initialDocId?: string;
};

export function AppShell({ initialTree, initialDocId }: AppShellProps) {
  const [scope, setScope] = useState<Scope>('shared');
  const [activeId, setActiveId] = useState<string>(initialDocId ?? '__home');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [prompts, setPrompts] = useState<string[]>(DEFAULT_PROMPTS);
  const [generatedDocs, setGeneratedDocs] = useState<Record<string, GeneratedDoc>>({});
  const [liveDoc, setLiveDoc] = useState<LiveDoc | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [tree, setTree] = useState<ApiTreeNode[]>(initialTree);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTab, setUploadTab] = useState<LibraryTab>('upload');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const initial = (document.documentElement.dataset.theme as Theme | undefined) ?? DEFAULT_THEME;
    setThemeState(initial);
  }, []);

  // Load the initial doc if navigated to via URL
  useEffect(() => {
    if (initialDocId && !HOME_IDS.has(initialDocId) && !initialDocId.startsWith('__')) {
      setDocLoading(true);
      getDoc(initialDocId)
        .then(async (api) => {
          const html = await renderMarkdown(api.raw_markdown);
          setLiveDoc(apiDocToDoc(api, html));
        })
        .catch(() => showToast('Failed to load document'))
        .finally(() => setDocLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDocId]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      // ignore storage failures
    }
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Sync activeId/liveDoc when browser Back/Forward changes the URL
  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname.replace(/^\//, '');
      if (!path) {
        setActiveId('__home');
        setLiveDoc(null);
        setEditing(false);
        return;
      }
      const docId = decodeURIComponent(path);
      setActiveId(docId);
      setEditing(false);
      setDocLoading(true);
      setLiveDoc(null);
      getDoc(docId)
        .then(async (api) => {
          const html = await renderMarkdown(api.raw_markdown);
          setLiveDoc(apiDocToDoc(api, html));
        })
        .catch(() => showToast('Failed to load document'))
        .finally(() => setDocLoading(false));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [showToast]);

  const openDoc = useCallback(
    (id: string) => {
      if (HOME_IDS.has(id)) {
        setActiveId(id);
        setLiveDoc(null);
        setEditing(false);
        window.history.pushState(null, '', '/');
        return;
      }
      if (id.startsWith('__')) {
        setActiveId(id);
        setLiveDoc(null);
        setEditing(false);
        return;
      }
      // Generated docs stay local (no URL)
      if (generatedDocs[id]) {
        setActiveId(id);
        setLiveDoc(null);
        setEditing(false);
        return;
      }
      // Real doc — update URL and fetch client-side
      setActiveId(id);
      setEditing(false);
      setDocLoading(true);
      setLiveDoc(null);
      window.history.pushState(null, '', `/${id}`);
      getDoc(id)
        .then(async (api) => {
          const html = await renderMarkdown(api.raw_markdown);
          setLiveDoc(apiDocToDoc(api, html));
        })
        .catch(() => showToast('Failed to load document'))
        .finally(() => setDocLoading(false));
    },
    [generatedDocs, showToast],
  );

  const onNewPage = () => {
    setScope('personal');
    setActiveId('__new');
    setEditing(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setChatOpen((o) => !o);
      }
      if (e.key === 'Escape' && !paletteOpen) {
        setChatOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen]);

  const generatedDoc = generatedDocs[activeId];
  const doc: Doc | undefined = liveDoc ?? generatedDoc;

  const generateFromPrompt = (prompt: string): string => {
    const { id, doc: gen } = buildGeneratedDocFromPrompt(prompt);
    setGeneratedDocs((prev) => ({ ...prev, [id]: gen }));
    return id;
  };

  const handleAskPrompt = (p: string, opts?: { createPage?: boolean }) => {
    if (opts?.createPage) {
      const id = generateFromPrompt(p);
      setScope('personal');
      setActiveId(id);
      setEditing(false);
      showToast('Generated page added to My wiki');
      return;
    }
    setChatOpen(true);
    window.dispatchEvent(new CustomEvent<string>(ASK_EVENT, { detail: p }));
  };

  const handleSaveFromChat = (page: GeneratedDoc) => {
    const id = makeId('doc-me-gen-');
    setGeneratedDocs((prev) => ({ ...prev, [id]: page }));
    setScope('personal');
    setActiveId(id);
    setChatOpen(false);
    showToast(`Saved "${page.title}" to your wiki`);
  };

  const handleEditorSave = (title: string, docId?: string) => {
    setEditing(false);
    showToast(`Saved "${title}" to your wiki`);
    getTree().then(setTree).catch(() => showToast('Failed to refresh sidebar'));
    if (docId) {
      openDoc(docId);
    }
  };

  return (
    <div className="app">
      <TopBar
        onSearch={() => setPaletteOpen(true)}
        onToggleChat={() => setChatOpen((o) => !o)}
        chatOpen={chatOpen}
        theme={theme}
        setTheme={setTheme}
      />
      <Sidebar
        scope={scope}
        setScope={setScope}
        activeId={activeId}
        onOpen={openDoc}
        onNewPage={onNewPage}
        onUpload={() => { setUploadTab('upload'); setUploadOpen(true); }}
        onProcessPending={() => { setUploadTab('pending'); setUploadOpen(true); }}
        onReindex={() => { setUploadTab('reindex'); setUploadOpen(true); }}
        apiTree={tree}
      />
      <main className="main">
        {editing ? (
          <Editor
            doc={doc}
            docId={activeId !== '__new' ? activeId : undefined}
            etag={liveDoc?.etag}
            onClose={() => setEditing(false)}
            onSave={handleEditorSave}
            showToast={showToast}
          />
        ) : HOME_IDS.has(activeId) ? (
          <HomeView
            onOpen={openDoc}
            onAsk={() => setChatOpen(true)}
            prompts={prompts}
            setPrompts={setPrompts}
            onAskPrompt={handleAskPrompt}
            onUpload={() => { setUploadTab('upload'); setUploadOpen(true); }}
            docCount={countTreeDocs(tree)}
            wikiCount={countTreeDocs(tree.filter(n => n.type === 'folder' && n.name.toLowerCase() === 'wiki'))}
          />
        ) : docLoading ? (
          <div className="empty-state">
            <div className="es-inner">
              <div style={{ color: 'var(--fg-3)' }}>{ICONS.doc}</div>
              <p>Loading…</p>
            </div>
          </div>
        ) : doc ? (
          <DocReader
            doc={doc}
            docId={activeId}
            onAskInChat={() => setChatOpen(true)}
            onEdit={() => setEditing(true)}
            onStarToggle={(starred, etag) => {
              if (liveDoc) setLiveDoc({ ...liveDoc, starred, etag });
            }}
          />
        ) : (
          <div className="empty-state">
            <div className="es-inner">
              <div style={{ color: 'var(--fg-3)' }}>{ICONS.doc}</div>
              <h3>No document selected</h3>
              <p>Pick a document from the sidebar, or hit ⌘K to search.</p>
            </div>
          </div>
        )}
      </main>

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onOpenDoc={openDoc}
        onSavePage={handleSaveFromChat}
        contextDoc={doc}
      />

      {!chatOpen && <ChatFab onClick={() => setChatOpen(true)} />}

      <SearchPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenDoc={openDoc}
      />

      <UploadModal
        open={uploadOpen}
        initialTab={uploadTab}
        spaces={tree.filter((n) => n.type === 'folder').map((n) => n.id.replace('folder:', ''))}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => getTree().then(setTree).catch(() => showToast('Failed to refresh sidebar'))}
        showToast={showToast}
      />

      <ToastStack message={toast} />
    </div>
  );
}
