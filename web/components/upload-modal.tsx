'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ICONS } from '@/lib/icons';
import { withBasePath } from '@/lib/base-path';
import { DEFAULT_USER_ID } from '@/lib/vault-paths';
import type { FeatureFlags } from '@/lib/flags';
import type { ApiTreeNode } from '@/lib/api';

export type LibraryTab = 'upload' | 'pending' | 'reindex' | 'folders';

type Scope = 'shared' | 'user';

type UploadModalProps = {
  open: boolean;
  initialTab?: LibraryTab;
  spaces: string[];
  /** Full sidebar tree — used to suggest existing subfolders for autocomplete. */
  tree: ApiTreeNode[];
  onClose: () => void;
  onUploaded: () => void;
  showToast: (msg: string) => void;
  flags: FeatureFlags;
};

/**
 * Collect existing subfolder paths (relative to the space root, e.g.
 * `"guides"`, `"guides/setup"`) for a given scope + space, walking the live
 * sidebar tree. Used to populate the subfolder autocomplete so users can drop
 * files into a folder that already exists instead of re-typing the path.
 */
function collectSubfolders(tree: ApiTreeNode[], scope: Scope, space: string): string[] {
  if (!space || space === '__all') return [];

  let spaceNode: ApiTreeNode | undefined;
  if (scope === 'user') {
    const userRoot = tree.find((n) => n.type === 'folder' && n.id === 'folder:__user');
    spaceNode =
      userRoot?.type === 'folder'
        ? userRoot.children.find((n) => n.type === 'folder' && n.id === `folder:__user/${space}`)
        : undefined;
  } else {
    spaceNode = tree.find((n) => n.type === 'folder' && n.id === `folder:${space}`);
  }
  if (!spaceNode || spaceNode.type !== 'folder') return [];

  const prefix = scope === 'user' ? `folder:__user/${space}/` : `folder:${space}/`;
  const out: string[] = [];
  const walk = (nodes: ApiTreeNode[]) => {
    for (const n of nodes) {
      if (n.type !== 'folder') continue;
      if (n.id.startsWith(prefix)) out.push(n.id.slice(prefix.length));
      walk(n.children);
    }
  };
  walk(spaceNode.children);
  return out.sort();
}

type FileStatus = 'queued' | 'uploading' | 'indexing' | 'indexed' | 'queued-curate' | 'error';
type UploadFile = { id: string; name: string; size: number; file: File; status: FileStatus; progress: number; error?: string };
type FileStage = 'reading' | 'extracting' | 'writing' | 'manifest';
type JobPhase = 'chaining';

type Destination = 'raw' | 'authored';
type StreamLine = {
  name: string;
  ts: string;
  status: 'curating' | 'indexed' | 'error';
  error?: string;
  duration?: string;
  stage?: FileStage;
  startedAt?: string;
};

const STAGE_LABEL: Record<FileStage, string> = {
  reading: 'reading source',
  extracting: 'calling Bedrock',
  writing: 'writing pages',
  manifest: 'updating manifest',
};

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function defaultSpace(spaces: string[]): string {
  return spaces.includes('wiki') ? 'wiki' : spaces.find((s) => s !== 'personal') ?? spaces[0] ?? 'wiki';
}

export function UploadModal({ open, initialTab, spaces, tree, onClose, onUploaded, showToast, flags }: UploadModalProps) {
  const [tab, setTab] = useState<LibraryTab>(initialTab ?? 'upload');
  const [scope, setScope] = useState<Scope>('shared');
  const [space, setSpace] = useState(defaultSpace(spaces));
  const [destination, setDestination] = useState<Destination>('raw');
  const [folder, setFolder] = useState('');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // Refs for latest values (avoids stale closures in async chains)
  const scopeRef = useRef(scope);
  const spaceRef = useRef(space);
  const destinationRef = useRef(destination);
  const folderRef = useRef(folder);
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  useEffect(() => { spaceRef.current = space; }, [space]);
  useEffect(() => { destinationRef.current = destination; }, [destination]);
  useEffect(() => { folderRef.current = folder; }, [folder]);

  // Subfolders that already exist in the selected scope + space, for autocomplete.
  const subfolderSuggestions = collectSubfolders(tree, scope, space);

  // Build the scope-bearing query string fragment used by GETs.
  const scopeQuery = (s: Scope = scope): string =>
    s === 'user' ? `&scope=user&userId=${encodeURIComponent(DEFAULT_USER_ID)}` : '';
  // Build the scope payload used by POSTs.
  const scopePayload = (s: Scope = scope): Record<string, string> =>
    s === 'user' ? { scope: 'user', userId: DEFAULT_USER_ID } : { scope: 'shared' };

  // Pending tab
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingLimit, setPendingLimit] = useState('5');
  const [pendingJobTotal, setPendingJobTotal] = useState(0);
  const [pendingStream, setPendingStream] = useState<StreamLine[]>([]);
  const [pendingRunning, setPendingRunning] = useState(false);
  const [pendingDone, setPendingDone] = useState(false);
  const [pendingNow, setPendingNow] = useState<number>(() => Date.now());
  const [pendingPhase, setPendingPhase] = useState<JobPhase | null>(null);
  const [pendingFinalizing, setPendingFinalizing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // Re-render every second while running so elapsed timers tick smoothly.
  useEffect(() => {
    if (!pendingRunning) return;
    const id = setInterval(() => setPendingNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pendingRunning]);

  // Reindex tab
  const [reindexRunning, setReindexRunning] = useState(false);
  const [reindexDone, setReindexDone] = useState(false);
  const [reindexTotal, setReindexTotal] = useState(0);
  const [reindexIndexed, setReindexIndexed] = useState(0);
  const [reindexRawCount, setReindexRawCount] = useState(0);

  // Folders tab
  const [newSpaceName, setNewSpaceName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);

  // Reset on open
  useEffect(() => {
    if (!open) {
      // Abort any running stream on close
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    setTab(initialTab ?? 'upload');
    setScope('shared'); setDestination('raw'); setFolder('');
    setFiles([]); setDragActive(false);
    setPendingStream([]); setPendingRunning(false); setPendingDone(false); setPendingJobTotal(0); setPendingPhase(null); setPendingFinalizing(false);
    setReindexRunning(false); setReindexDone(false); setReindexTotal(0); setReindexIndexed(0); setReindexRawCount(0);
    setNewSpaceName(''); setRenaming(null); setRenameValue(''); setConfirmingDelete(null); setFolderBusy(false);
    if (spaces.length && !spaces.includes(space)) setSpace(defaultSpace(spaces));
  }, [open, initialTab]);

  // Fetch pending count when space/scope changes.
  useEffect(() => {
    if (!open) return;
    if (tab === 'pending' && space !== 'wiki') {
      setSpace('wiki');
      return;
    }
    const ctrl = new AbortController();
    fetch(withBasePath(`/api/raw?space=${encodeURIComponent(space)}${scopeQuery(scope)}`), { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => setPendingCount(d.count ?? 0))
      .catch(() => { if (!ctrl.signal.aborted) setPendingCount(0); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, space, tab, scope]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const updateFile = useCallback((id: string, patch: Partial<UploadFile>) => {
    setFiles(curr => curr.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const processFile = useCallback(async (entry: UploadFile) => {
    const currentScope = scopeRef.current;
    const currentSpace = spaceRef.current;
    const currentDestination = destinationRef.current;

    updateFile(entry.id, { status: 'uploading', progress: 0 });
    const form = new FormData();
    form.append('file', entry.file);
    form.append('destination', currentDestination);
    form.append('scope', currentScope);
    if (currentScope === 'user') form.append('userId', DEFAULT_USER_ID);
    if (currentDestination === 'authored') form.append('space', currentSpace);
    const currentFolder = folderRef.current.trim().replace(/^\/+|\/+$/g, '');
    if (currentFolder) form.append('folder', currentFolder);
    try {
      const res = await fetch(withBasePath('/api/upload'), { method: 'POST', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: 'Upload failed' }));
        updateFile(entry.id, { status: 'error', error: data.detail || 'Upload failed' });
        return;
      }
      // Authored writes are finalized server-side (indexes regened, log appended).
      // Raw writes are deferred — curate batch picks them up later.
      updateFile(entry.id, {
        status: currentDestination === 'authored' ? 'indexed' : 'queued-curate',
        progress: 100,
      });
    } catch { updateFile(entry.id, { status: 'error', error: 'Network error' }); }
  }, [updateFile]);

  const addFiles = useCallback((list: FileList) => {
    const incoming: UploadFile[] = Array.from(list)
      .filter(f => f.name.endsWith('.md') || f.name.endsWith('.markdown'))
      .map(f => ({ id: 'u-' + Math.random().toString(36).slice(2, 8), name: f.name, size: f.size, file: f, status: 'queued' as FileStatus, progress: 0 }));
    if (!incoming.length) return;
    setFiles(curr => [...curr, ...incoming]);
    let chain = Promise.resolve();
    for (const entry of incoming) { chain = chain.then(() => processFile(entry)); }
  }, [processFile]);

  const removeFile = (id: string) => setFiles(curr => curr.filter(f => f.id !== id));
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); dragCounter.current = 0; if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };
  const onDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current += 1; setDragActive(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current -= 1; if (dragCounter.current <= 0) setDragActive(false); };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const onPick = () => inputRef.current?.click();

  const allDone = files.length > 0 && files.every(f => f.status === 'indexed' || f.status === 'queued-curate' || f.status === 'error');
  const anyActive = files.some(f => f.status === 'uploading' || f.status === 'indexing' || f.status === 'queued');

  const finishUpload = () => { onUploaded(); onClose(); const n = files.filter(f => f.status === 'indexed').length; const sub = folder.trim().replace(/^\/+|\/+$/g, ''); if (n) showToast(`Uploaded ${n} file${n > 1 ? 's' : ''} to ${space}${sub ? `/${sub}` : ''}`); };

  // ── Pending tab: Lambda-based curation with polling ──
  const startPendingStream = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPendingStream([]); setPendingRunning(true); setPendingDone(false); setPendingJobTotal(0); setPendingPhase(null); setPendingFinalizing(false);
    try {
      const limit = pendingLimit === 'all' ? undefined : Number.parseInt(pendingLimit, 10);
      // Start the Lambda job
      const startRes = await fetch(withBasePath('/api/curate/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space, ...(limit ? { limit } : {}), ...scopePayload() }),
        signal: ctrl.signal,
      });
      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        setPendingRunning(false);
        showToast(data.detail || 'Failed to start processing');
        return;
      }
      const { jobId, total } = await startRes.json() as { jobId: string; total: number };
      if (!jobId) { setPendingRunning(false); showToast('No pending files'); return; }
      jobIdRef.current = jobId;
      setPendingJobTotal(total);

      // Poll for status
      const poll = async () => {
        while (!ctrl.signal.aborted) {
          await new Promise(r => setTimeout(r, 1200));
          if (ctrl.signal.aborted) return;

          const statusRes = await fetch(withBasePath(`/api/curate/status?job=${encodeURIComponent(jobId)}${scopeQuery()}`), { signal: ctrl.signal });
          if (!statusRes.ok) continue;
          const job = await statusRes.json() as {
            status: string;
            phase?: JobPhase;
            files: Array<{
              key: string;
              status: string;
              pages?: string[];
              error?: string;
              stage?: FileStage;
              startedAt?: string;
              finishedAt?: string;
            }>;
            completed: number;
            total: number;
          };
          setPendingPhase(job.phase ?? null);

          const fmtTs = (iso: string) => {
            const n = new Date(iso);
            return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}:${String(n.getSeconds()).padStart(2, '0')}`;
          };
          const fmtDur = (start?: string, end?: string) => {
            if (!start || !end) return undefined;
            const ms = new Date(end).getTime() - new Date(start).getTime();
            if (!Number.isFinite(ms) || ms < 0) return undefined;
            const s = Math.round(ms / 100) / 10;
            return `${s}s`;
          };
          const lines: StreamLine[] = job.files.map(f => ({
            name: f.key.split('/').slice(-1)[0] ?? f.key,
            ts: (f.status === 'done' || f.status === 'error') && f.finishedAt ? fmtTs(f.finishedAt) : '',
            status: f.status === 'done' ? 'indexed' : f.status === 'error' ? 'error' : 'curating',
            error: f.error,
            stage: f.stage,
            startedAt: f.startedAt,
            duration: fmtDur(f.startedAt, f.finishedAt),
          }));
          setPendingStream(lines);
          setPendingNow(Date.now());

          if (job.status === 'stale') {
            setPendingRunning(false);
            setPendingDone(false);
            showToast('Processing appears stale. Retry the pending batch.');
            return;
          }

          if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
            setPendingRunning(false);
            if (job.status === 'done') {
              setPendingFinalizing(true);
              try {
                const finalizeRes = await fetch(withBasePath('/api/curate/finalize'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ jobId, ...scopePayload() }),
                });
                if (!finalizeRes.ok) {
                  const data = await finalizeRes.json().catch(() => ({}));
                  showToast(data.detail || 'Finalize failed — search index may be stale');
                }
              } catch {
                showToast('Finalize failed — search index may be stale');
              } finally {
                setPendingFinalizing(false);
              }
            }
            setPendingDone(true);
            onUploaded();
            return;
          }
        }
      };
      await poll();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setPendingRunning(false); showToast('Processing failed');
    }
  };

  const cancelPending = async () => {
    if (jobIdRef.current) {
      fetch(withBasePath('/api/curate/cancel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobIdRef.current, ...scopePayload() }),
      }).catch(() => {});
    }
    abortRef.current?.abort();
    setPendingRunning(false);
  };

  // ── Re-index tab ──
  const startReindex = async () => {
    setReindexRunning(true); setReindexDone(false); setReindexTotal(0); setReindexIndexed(0); setReindexRawCount(0);
    try {
      const res = await fetch(withBasePath('/api/reindex'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(space === '__all' ? {} : { space }), ...scopePayload() }),
      });
      if (!res.ok || !res.body) { setReindexRunning(false); showToast('Re-index failed'); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.type === 'start') { setReindexTotal(msg.total); setReindexRawCount(msg.rawCount ?? 0); }
          else if (msg.type === 'progress') setReindexIndexed(msg.indexed);
          else if (msg.type === 'done') { setReindexIndexed(msg.indexed); }
          else if (msg.type === 'error') { showToast(msg.detail); }
        }
      }
      setReindexRunning(false); setReindexDone(true);
      onUploaded();
      showToast(`Re-indexed ${space === '__all' ? 'all spaces' : space}`);
    } catch { setReindexRunning(false); showToast('Re-index failed'); }
  };

  // ── Folders tab: space create / rename / delete ──
  const createSpace = async () => {
    const name = newSpaceName.trim().toLowerCase();
    if (!name) return;
    setFolderBusy(true);
    try {
      const res = await fetch(withBasePath('/api/spaces'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.detail || 'Could not create folder'); return; }
      setNewSpaceName('');
      showToast(`Created folder "${name}"`);
      onUploaded();
    } catch { showToast('Network error'); }
    finally { setFolderBusy(false); }
  };

  const submitRename = async (from: string) => {
    const to = renameValue.trim().toLowerCase();
    if (!to || to === from) { setRenaming(null); return; }
    setFolderBusy(true);
    try {
      const res = await fetch(withBasePath('/api/spaces'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.detail || 'Could not rename folder'); return; }
      setRenaming(null);
      if (space === from) setSpace(to);
      showToast(`Renamed "${from}" → "${to}"`);
      onUploaded();
    } catch { showToast('Network error'); }
    finally { setFolderBusy(false); }
  };

  const deleteSpace = async (name: string) => {
    setFolderBusy(true);
    try {
      const res = await fetch(withBasePath(`/api/spaces?name=${encodeURIComponent(name)}`), { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || 'Could not delete folder');
        return;
      }
      setConfirmingDelete(null);
      if (space === name) setSpace(defaultSpace(spaces.filter((s) => s !== name)));
      showToast(`Deleted folder "${name}"`);
      onUploaded();
    } catch { showToast('Network error'); }
    finally { setFolderBusy(false); }
  };

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={onClose} style={{ paddingTop: '7vh' }}>
      <div className="upload-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="upload-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--accent)' }}>{ICONS.upload}</span>
            <b>Library</b>
            <span style={{ color: 'var(--fg-3)', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>{pendingCount} pending</span>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">{ICONS.close}</button>
        </div>

        {/* Scope toggle — every operation in this modal is bound to this scope.
            Folder management is vault-global, so the toggle is hidden there. */}
        {tab !== 'folders' && (
        <div className="upload-meta" style={{ borderBottom: '1px solid var(--border-1, rgba(255,255,255,0.08))', paddingBottom: 12 }}>
          <div className="upload-meta-row">
            <label>Scope</label>
            <div className="space-select">
              <button
                className={'space-pill' + (scope === 'shared' ? ' on' : '')}
                onClick={() => setScope('shared')}
                disabled={pendingRunning || reindexRunning}
                title="Shared library — visible to everyone in a multi-tenant deployment"
              >
                {ICONS.globe}
                <span>Shared</span>
              </button>
              <button
                className={'space-pill' + (scope === 'user' ? ' on' : '')}
                onClick={() => setScope('user')}
                disabled={pendingRunning || reindexRunning}
                title="My library — isolated to this user's subtree"
              >
                {ICONS.user ?? ICONS.globe}
                <span>My ({DEFAULT_USER_ID})</span>
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Tabs */}
        <div className="upload-tabs">
          {flags.upload && (
            <button className={'upload-tab' + (tab === 'upload' ? ' on' : '')} onClick={() => setTab('upload')}>
              {ICONS.upload} Upload
            </button>
          )}
          {flags.curate && (
            <button className={'upload-tab' + (tab === 'pending' ? ' on' : '')} onClick={() => setTab('pending')}>
              {ICONS.spark} Pending
              {pendingCount > 0 && <span className="upload-tab-badge">{pendingCount}</span>}
            </button>
          )}
          {flags.reindex && (
            <button className={'upload-tab' + (tab === 'reindex' ? ' on' : '')} onClick={() => setTab('reindex')}>
              {ICONS.recent} Re-index
            </button>
          )}
          {flags.upload && (
            <button className={'upload-tab' + (tab === 'folders' ? ' on' : '')} onClick={() => setTab('folders')}>
              {ICONS.folder} Folders
            </button>
          )}
        </div>

        {/* Space selector — not shown on the Folders tab, which manages spaces. */}
        {tab !== 'folders' && (
        <div className="upload-meta">
          <div className="upload-meta-row">
            <label>Space</label>
            <div className="space-select">
              {tab === 'pending' ? (
                <button className="space-pill on" onClick={() => setSpace('wiki')}>
                  {ICONS.globe}
                  <span>wiki</span>
                </button>
              ) : (tab === 'reindex') && (
                <button className={'space-pill' + (space === '__all' ? ' on' : '')} onClick={() => setSpace('__all')}>
                  {ICONS.globe}
                  <span>All</span>
                </button>
              )}
              {tab !== 'pending' && spaces.map(s => (
                <button key={s} className={'space-pill' + (space === s ? ' on' : '')} onClick={() => { setSpace(s); setFolder(''); }}>
                  {ICONS.globe}
                  <span>{s}</span>
                </button>
              ))}
            </div>
          </div>
          {tab === 'upload' && (
            <div className="upload-meta-row">
              <label>Destination</label>
              <div className="space-select">
                <button className={'space-pill' + (destination === 'raw' ? ' on' : '')} onClick={() => setDestination('raw')}>
                  <span>raw/</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>process with AI later</span>
                </button>
                <button className={'space-pill' + (destination === 'authored' ? ' on' : '')} onClick={() => setDestination('authored')}>
                  <span>authored/</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>final, no AI</span>
                </button>
              </div>
            </div>
          )}
          {tab === 'upload' && (
            <div className="upload-meta-row">
              <label>Subfolder</label>
              <div className="space-select" style={{ flex: 1, gap: 6 }}>
                <input
                  className="upload-input"
                  placeholder="optional · e.g. guides/setup"
                  value={folder}
                  list="subfolder-suggestions"
                  onChange={(e) => setFolder(e.target.value)}
                  style={{ flex: 1 }}
                />
                <datalist id="subfolder-suggestions">
                  {subfolderSuggestions.map((p) => <option key={p} value={p} />)}
                </datalist>
              </div>
            </div>
          )}
          <div className="upload-s3-preview">
            {ICONS.s3}
            <span>
              s3://vaultmark/
              {scope === 'user' ? `users/${DEFAULT_USER_ID}/` : ''}
              {destination === 'raw' ? 'raw/' : `authored/${space}/`}
              {folder.trim() ? `${folder.trim().replace(/^\/+|\/+$/g, '')}/` : ''}
            </span>
          </div>
        </div>
        )}

        {/* Upload tab */}
        {tab === 'upload' && (
          <>
            <div className={'upload-drop' + (dragActive ? ' active' : '') + (files.length ? ' compact' : '')}
                 onDrop={onDrop} onDragOver={onDragOver} onDragEnter={onDragEnter} onDragLeave={onDragLeave}
                 onClick={files.length ? undefined : onPick}
                 role={files.length ? undefined : 'button'} tabIndex={files.length ? undefined : 0}
                 onKeyDown={files.length ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}>
              <input ref={inputRef} type="file" multiple accept=".md,.markdown"
                     onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
                     style={{ display: 'none' }}/>
              {files.length === 0 ? (
                <div className="upload-drop-inner">
                  <div className="upload-drop-icon">{ICONS.upload}</div>
                  <div className="upload-drop-title">Drag Markdown files here</div>
                  <div className="upload-drop-sub">or <button className="link-btn" onClick={e => { e.stopPropagation(); onPick(); }}>browse</button> from your computer</div>
                  <div className="upload-drop-hint">
                    <span className="kbd">.md</span><span className="kbd">.markdown</span>
                    <span style={{ color: 'var(--fg-3)' }}>up to 25 MB each</span>
                  </div>
                </div>
              ) : (
                <div className="upload-drop-compact">
                  <span>{ICONS.upload}</span>
                  <span>Drop more files or</span>
                  <button className="btn ghost" onClick={e => { e.stopPropagation(); onPick(); }}>browse</button>
                </div>
              )}
            </div>

            {files.length > 0 && (
              <div className="upload-list">
                {files.map(f => (
                  <div key={f.id} className={'upload-row ' + f.status}>
                    <span className="upload-row-icon">{ICONS.file}</span>
                    <div className="upload-row-body">
                      <div className="upload-row-title">
                        <span className="upload-row-name">{f.name}</span>
                        <span className="upload-row-size">{fmtSize(f.size)}</span>
                      </div>
                      <div className="upload-row-status">
                        {f.status === 'queued' && <span>queued…</span>}
                        {f.status === 'uploading' && <><span>uploading to S3</span><span className="upload-row-pct">{Math.round(f.progress)}%</span></>}
                        {f.status === 'indexing' && <><span className="spinner"></span><span>indexing</span></>}
                        {f.status === 'queued-curate' && <><span style={{ color: 'var(--amber, #f59e0b)' }}>●</span><span>uploaded · curate via Pending tab</span></>}
                        {f.status === 'indexed' && <><span style={{ color: 'var(--green, #22c55e)' }}>{ICONS.check}</span><span style={{ color: 'var(--green, #22c55e)' }}>indexed · searchable</span></>}
                        {f.status === 'error' && <span style={{ color: 'var(--red, #e53e3e)' }}>{f.error}</span>}
                      </div>
                      {(f.status === 'uploading' || f.status === 'indexing') && (
                        <div className="upload-row-bar"><div className="upload-row-bar-fill" style={{ width: (f.status === 'indexing' ? 100 : f.progress) + '%' }}></div></div>
                      )}
                    </div>
                    <button className="upload-row-x" onClick={() => removeFile(f.id)} title="Remove">{ICONS.trash}</button>
                  </div>
                ))}
              </div>
            )}

            <div className="upload-foot">
              <span style={{ flex: 1 }}></span>
              <span className="upload-summary">
                {files.length === 0 && 'No files selected'}
                {files.length > 0 && anyActive && `${files.filter(f => f.status === 'indexed').length} of ${files.length} indexed`}
                {files.length > 0 && allDone && `${files.length} file${files.length > 1 ? 's' : ''} ready`}
              </span>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={files.length === 0 || anyActive} onClick={finishUpload}>
                {allDone ? <>{ICONS.check} Done</> : <>{ICONS.upload} Upload {files.length || ''}</>}
              </button>
            </div>
          </>
        )}

        {/* Pending tab */}
        {tab === 'pending' && (
          <>
            <div className="pending-summary">
              <div className="pending-stat">
                <div className="pending-stat-value">{pendingCount}</div>
                <div className="pending-stat-label">raw files in <code>{space}</code></div>
              </div>
              <span style={{ flex: 1 }}></span>
              <div className="pending-route"><code>POST /api/curate/start</code></div>
            </div>

            <div className="upload-list pending-stream">
              {pendingStream.length === 0 && !pendingRunning && (
                <div className="pending-empty">
                  <div className="upload-drop-icon" style={{ margin: '0 auto 12px' }}>{ICONS.spark}</div>
                  <div className="upload-drop-title">Process pending raw files</div>
                  <div className="upload-drop-sub">
                    {pendingCount} file{pendingCount === 1 ? '' : 's'} in <code>raw/</code> waiting to be curated into <code>generated/wiki/</code>.
                  </div>
                </div>
              )}
              {pendingStream.map((e, i) => {
                const elapsedSec = e.status === 'curating' && e.startedAt
                  ? Math.max(0, Math.round((pendingNow - new Date(e.startedAt).getTime()) / 1000))
                  : null;
                return (
                  <div key={i} className={'stream-line ' + e.status}>
                    <span className="stream-ts">{e.ts}</span>
                    <span className="stream-arrow">{e.status === 'indexed' ? ICONS.check : e.status === 'error' ? ICONS.warn : '·'}</span>
                    <span className="stream-name">{e.name}</span>
                    {e.status === 'curating' && <span className="spinner"></span>}
                    {e.status === 'curating' && e.stage && (
                      <span className="stream-stage" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                        {STAGE_LABEL[e.stage]}
                      </span>
                    )}
                    {elapsedSec !== null && (
                      <span className="stream-duration" style={{ color: 'var(--fg-3)' }}>{elapsedSec}s</span>
                    )}
                    {e.error && <span className="stream-error">{e.error}</span>}
                    {e.duration && e.status !== 'curating' && <span className="stream-duration">{e.duration}</span>}
                  </div>
                );
              })}
            </div>
            {(pendingRunning || pendingDone) && pendingJobTotal > 0 && (
              <div className="upload-row-bar" style={{ marginTop: 8 }}>
                <div
                  className="upload-row-bar-fill"
                  style={{
                    width:
                      (Math.min(
                        100,
                        (pendingStream.filter(e => e.status === 'indexed' || e.status === 'error').length /
                          pendingJobTotal) * 100,
                      )) + '%',
                  }}
                ></div>
              </div>
            )}
            {pendingRunning && pendingPhase === 'chaining' && (
              <div
                className="stream-line"
                style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-2)' }}
              >
                <span className="spinner"></span>
                <span style={{ marginLeft: 8 }}>
                  Continuing in a new worker — batch is being handed off to avoid the 5-minute Lambda timeout…
                </span>
              </div>
            )}
            {pendingFinalizing && (
              <div
                className="stream-line"
                style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-2)' }}
              >
                <span className="spinner"></span>
                <span style={{ marginLeft: 8 }}>
                  Finalizing — regenerating index.md and refreshing search…
                </span>
              </div>
            )}

            <div className="upload-foot">
              <div className="batch-control" aria-label="Batch size">
                <span>Batch</span>
                {['1', '5', '10', '25', 'all'].map(value => (
                  <button
                    key={value}
                    type="button"
                    className={'batch-pill' + (pendingLimit === value ? ' on' : '')}
                    disabled={pendingRunning}
                    onClick={() => setPendingLimit(value)}
                  >
                    {value === 'all' ? 'All' : value}
                  </button>
                ))}
              </div>
              <span className="upload-summary">
                {!pendingRunning && !pendingDone && !pendingFinalizing && (pendingCount === 0 ? 'Nothing pending' : `${pendingCount} file${pendingCount > 1 ? 's' : ''} pending`)}
                {pendingFinalizing && 'Finalizing index…'}
                {pendingRunning && (() => {
                  const doneCount = pendingStream.filter(e => e.status === 'indexed' || e.status === 'error').length;
                  const active = pendingStream.find(e => e.status === 'curating');
                  const total = pendingJobTotal || pendingCount;
                  if (active) {
                    const stageText = active.stage ? STAGE_LABEL[active.stage] : 'processing';
                    return `${doneCount} / ${total} · ${active.name} (${stageText})`;
                  }
                  return `${doneCount} / ${total} done`;
                })()}
                {pendingDone && `${pendingStream.length} curated · searchable now`}
              </span>
              <span style={{ flex: 1 }}></span>
              <button className="btn ghost" onClick={onClose}>Close</button>
              {!pendingRunning ? (
                <button
                  className="btn primary"
                  disabled={pendingCount === 0 || pendingFinalizing}
                  onClick={startPendingStream}
                >
                  {ICONS.spark} {pendingDone ? 'Run again' : 'Process batch'}
                </button>
              ) : (
                <button className="btn" onClick={cancelPending}>
                  Stop
                </button>
              )}
            </div>
          </>
        )}

        {/* Re-index tab */}
        {tab === 'reindex' && (
          <div className="reindex-panel">
            <div className="callout warn" style={{ margin: 0 }}>
              <span className="icon">{ICONS.warn}</span>
              <div>
                <div><strong>Re-index the <code>{space}</code> space</strong> from S3 content.</div>
                <div style={{ marginTop: 4, color: 'var(--fg-2)' }}>The index for this space will be rebuilt. Search results may be temporarily incomplete.</div>
              </div>
            </div>

            {(reindexRunning || reindexDone) && (
              <div className="reindex-progress">
                <div className="reindex-progress-text">
                  {reindexDone
                    ? <><span style={{ color: 'var(--green, #22c55e)' }}>{ICONS.check}</span> Re-index complete — {reindexIndexed} files</>
                    : <><span className="spinner"></span> Indexing {reindexIndexed} / {reindexTotal}</>
                  }
                </div>
                {reindexRawCount > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                    {reindexRawCount} file{reindexRawCount !== 1 ? 's' : ''} in <code>raw/</code> not yet processed
                  </div>
                )}
                <div className="upload-row-bar" style={{ marginTop: 6 }}>
                  <div className="upload-row-bar-fill" style={{ width: (reindexTotal ? (reindexIndexed / reindexTotal) * 100 : 0) + '%' }}></div>
                </div>
              </div>
            )}

            <div className="upload-foot" style={{ marginTop: 'auto' }}>
              <span style={{ flex: 1 }}></span>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              {!reindexDone ? (
                <button className="btn primary" disabled={reindexRunning} onClick={startReindex}>
                  {reindexRunning ? <><span className="spinner"></span> Re-indexing…</> : <>{ICONS.recent} Re-index space</>}
                </button>
              ) : (
                <button className="btn primary" onClick={onClose}>{ICONS.check} Done</button>
              )}
            </div>
          </div>
        )}

        {/* Folders tab */}
        {tab === 'folders' && (
          <>
            <div className="upload-meta" style={{ paddingTop: 4 }}>
              <div className="upload-meta-row">
                <label>New folder</label>
                <div className="space-select" style={{ flex: 1, gap: 6 }}>
                  <input
                    className="upload-input"
                    placeholder="e.g. handbook"
                    value={newSpaceName}
                    disabled={folderBusy}
                    onChange={(e) => setNewSpaceName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createSpace(); }}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn primary"
                    disabled={folderBusy || !newSpaceName.trim()}
                    onClick={createSpace}
                  >
                    {ICONS.plus} Create
                  </button>
                </div>
              </div>
              <div className="upload-s3-preview">
                {ICONS.s3}
                <span>s3://vaultmark/authored/{newSpaceName.trim().toLowerCase() || '<folder>'}/</span>
              </div>
            </div>

            <div className="callout warn" style={{ margin: '0 0 8px' }}>
              <span className="icon">{ICONS.warn}</span>
              <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                Renaming or deleting a folder affects <strong>both</strong> the shared
                library and every user&apos;s copy. Deleting removes all documents inside it.
              </div>
            </div>

            <div className="upload-list">
              {spaces.length === 0 && (
                <div className="pending-empty">
                  <div className="upload-drop-title">No folders yet</div>
                  <div className="upload-drop-sub">Create one above to start organizing authored documents.</div>
                </div>
              )}
              {spaces.map((s) => (
                <div key={s} className="upload-row">
                  <span className="upload-row-icon">{ICONS.folder}</span>
                  <div className="upload-row-body">
                    {renaming === s ? (
                      <div className="space-select" style={{ gap: 6 }}>
                        <input
                          className="upload-input"
                          value={renameValue}
                          disabled={folderBusy}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename(s);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          style={{ flex: 1 }}
                        />
                        <button className="btn primary" disabled={folderBusy} onClick={() => submitRename(s)}>{ICONS.check}</button>
                        <button className="btn ghost" disabled={folderBusy} onClick={() => setRenaming(null)}>Cancel</button>
                      </div>
                    ) : confirmingDelete === s ? (
                      <div className="upload-row-title" style={{ alignItems: 'center' }}>
                        <span style={{ color: 'var(--red, #e53e3e)' }}>Delete <code>{s}</code> and all its documents?</span>
                      </div>
                    ) : (
                      <div className="upload-row-title">
                        <span className="upload-row-name">{s}</span>
                        <span className="upload-row-size">authored/{s}/</span>
                      </div>
                    )}
                  </div>
                  {renaming !== s && (
                    confirmingDelete === s ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn" disabled={folderBusy} onClick={() => deleteSpace(s)} style={{ color: 'var(--red, #e53e3e)' }}>Delete</button>
                        <button className="btn ghost" disabled={folderBusy} onClick={() => setConfirmingDelete(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button className="icon-btn" disabled={folderBusy} title="Rename" onClick={() => { setRenaming(s); setRenameValue(s); }}>{ICONS.edit}</button>
                        <button className="icon-btn" disabled={folderBusy} title="Delete" onClick={() => setConfirmingDelete(s)}>{ICONS.trash}</button>
                      </div>
                    )
                  )}
                </div>
              ))}
            </div>

            <div className="upload-foot">
              <span style={{ flex: 1 }}></span>
              <span className="upload-summary">{spaces.length} folder{spaces.length === 1 ? '' : 's'}</span>
              <button className="btn ghost" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
