'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ICONS } from '@/lib/icons';
import { DOCS, type Doc, type GeneratedDoc, type Scope } from '@/lib/mock/data';
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

const HOME_IDS = new Set(['__home', '__recent', '__starred']);

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
    path: `personal / generated / ${slug}.md`,
    s3: `s3://wikillm/tenants/acme/users/u-1042/wiki/generated/${slug}.md`,
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

export function AppShell() {
  const [scope, setScope] = useState<Scope>('shared');
  const [activeId, setActiveId] = useState<string>('doc-prod-incident');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [prompts, setPrompts] = useState<string[]>(DEFAULT_PROMPTS);
  const [generatedDocs, setGeneratedDocs] = useState<Record<string, GeneratedDoc>>({});
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const initial = (document.documentElement.dataset.theme as Theme | undefined) ?? DEFAULT_THEME;
    setThemeState(initial);
  }, []);

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

  const openDoc = useCallback((id: string) => {
    if (id.startsWith('__')) {
      setActiveId(id);
      setEditing(false);
      return;
    }
    if (id.startsWith('doc-me-')) setScope('personal');
    else setScope('shared');
    setActiveId(id);
    setEditing(false);
  }, []);

  const onNewPage = () => {
    setScope('personal');
    setActiveId('__new');
    setEditing(true);
  };

  // Cmd+K / Cmd+Shift+A / Esc
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

  const doc: Doc | undefined = DOCS[activeId] || generatedDocs[activeId];

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

  const handleEditorSave = (title: string) => {
    setEditing(false);
    showToast(`Saved "${title}" to your wiki`);
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
      />
      <main className="main">
        {editing ? (
          <Editor
            doc={doc}
            onClose={() => setEditing(false)}
            onSave={(title) => handleEditorSave(title)}
          />
        ) : HOME_IDS.has(activeId) ? (
          <HomeView
            onOpen={openDoc}
            onAsk={() => setChatOpen(true)}
            prompts={prompts}
            setPrompts={setPrompts}
            onAskPrompt={handleAskPrompt}
          />
        ) : doc ? (
          <DocReader
            doc={doc}
            onAskInChat={() => setChatOpen(true)}
            onEdit={() => setEditing(true)}
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

      <ToastStack message={toast} />
    </div>
  );
}
