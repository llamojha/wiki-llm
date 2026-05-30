'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDoc, getTree, type ApiDoc, type ApiTreeNode } from '@/lib/api';
import { ICONS } from '@/lib/icons';
import { renderMarkdown } from '@/lib/markdown';
import { type Doc, type LiveDoc, type SanitizedHtml, type Scope } from '@/lib/types';
import { DEFAULT_THEME, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';
import type { FeatureFlags } from '@/lib/flags';
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

/** Convert an API doc response into a LiveDoc for DocReader. */
function apiDocToDoc(api: ApiDoc, html: SanitizedHtml): LiveDoc {
  const source = api.source_type === 'generated'
    ? 'generated'
    : api.source_type === 'personal'
      ? 'personal'
      : 'shared';
  return {
    generated: false,
    kind: 'live',
    id: api.id,
    title: api.title,
    path: api.path,
    s3: api.s3_key,
    source,
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
  flags: FeatureFlags;
};

export function AppShell({ initialTree, initialDocId, flags }: AppShellProps) {
  const [scope, setScope] = useState<Scope>('shared');
  const [activeId, setActiveId] = useState<string>(initialDocId ?? '__home');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [prompts, setPrompts] = useState<string[]>(DEFAULT_PROMPTS);
  const [liveDoc, setLiveDoc] = useState<LiveDoc | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [tree, setTree] = useState<ApiTreeNode[]>(initialTree);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTab, setUploadTab] = useState<LibraryTab>('upload');
  const [editorDraft, setEditorDraft] = useState<{ title: string; body: string } | undefined>(undefined);
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
    [showToast],
  );

  const onNewPage = () => {
    setScope('user');
    setActiveId('__new');
    setEditing(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flags.search && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      }
      if (flags.agent && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setChatOpen((o) => !o);
      }
      if (e.key === 'Escape' && !paletteOpen) {
        setChatOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, flags.search, flags.agent]);

  const doc: Doc | undefined = liveDoc ?? undefined;

  const handleAskPrompt = (p: string) => {
    setChatOpen(true);
    window.dispatchEvent(new CustomEvent<string>(ASK_EVENT, { detail: p }));
  };

  /**
   * Chat panel's post-hoc Save: open the Editor pre-filled with the agent's
   * answer + citations as a draft. User reviews/edits and the existing
   * Editor save flow (Phase 4) writes via POST /api/docs.
   */
  const handleDraftFromChat = (draft: { title: string; body: string }) => {
    setEditorDraft(draft);
    setScope('user');
    setActiveId('__new');
    setEditing(true);
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
        flags={flags}
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
        flags={flags}
      />
      <main className="main">
        {editing ? (
          <Editor
            doc={activeId === '__new' ? undefined : doc}
            docId={activeId !== '__new' ? activeId : undefined}
            etag={liveDoc?.etag}
            initialDraft={editorDraft}
            onClose={() => { setEditing(false); setEditorDraft(undefined); }}
            onSave={(title, id) => { setEditorDraft(undefined); handleEditorSave(title, id); }}
            showToast={showToast}
          />
        ) : HOME_IDS.has(activeId) ? (
          <HomeView
            view={activeId === '__starred' ? 'starred' : activeId === '__recent' ? 'recent' : 'home'}
            onOpen={openDoc}
            onAsk={() => setChatOpen(true)}
            prompts={prompts}
            setPrompts={setPrompts}
            onAskPrompt={handleAskPrompt}
            onUpload={() => { setUploadTab('upload'); setUploadOpen(true); }}
            docCount={countTreeDocs(tree)}
            wikiCount={countTreeDocs(tree.filter(n => n.type === 'folder' && n.name.toLowerCase() === 'wiki'))}
            flags={flags}
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
            onUpload={() => { setUploadTab('upload'); setUploadOpen(true); }}
            onStarToggle={(starred, etag) => {
              if (liveDoc) setLiveDoc({ ...liveDoc, starred, etag });
            }}
            flags={flags}
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

      {flags.agent && (
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onOpenDoc={openDoc}
          onDraftFromChat={handleDraftFromChat}
          contextDoc={doc}
        />
      )}

      {flags.agent && !chatOpen && <ChatFab onClick={() => setChatOpen(true)} />}

      {flags.search && (
        <SearchPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onOpenDoc={openDoc}
          scope={scope}
        />
      )}

      <UploadModal
        open={uploadOpen}
        initialTab={uploadTab}
        spaces={tree.filter((n) => n.type === 'folder' && !n.id.startsWith('folder:__')).map((n) => n.id.replace('folder:', ''))}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => getTree().then(setTree).catch(() => showToast('Failed to refresh sidebar'))}
        showToast={showToast}
        flags={flags}
      />

      <ToastStack message={toast} />
    </div>
  );
}
