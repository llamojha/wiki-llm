'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { withBasePath } from '@/lib/base-path';
import {
  type FolderNode,
  SEG_RE,
  childExists,
  descendantPaths,
  findFolder,
  validPath,
} from '@/lib/folder-tree';
import { DEFAULT_USER_ID } from '@/lib/vault-paths';
import type { FeatureFlags } from '@/lib/flags';

export type LibraryTab = 'upload' | 'pending' | 'reindex' | 'folders';

export type Scope = 'shared' | 'user';

export type FileStatus =
  | 'queued'
  | 'uploading'
  | 'indexing'
  | 'indexed'
  | 'queued-curate'
  | 'error';
export type UploadFile = {
  id: string;
  name: string;
  size: number;
  file: File;
  status: FileStatus;
  progress: number;
  error?: string;
};
export type FileStage = 'reading' | 'extracting' | 'writing' | 'manifest';
export type JobPhase = 'chaining';
export type Destination = 'raw' | 'authored';
export type StreamLine = {
  name: string;
  ts: string;
  status: 'curating' | 'indexed' | 'error';
  error?: string;
  duration?: string;
  stage?: FileStage;
  startedAt?: string;
};

const cleanSeg = (s: string): string => s.trim().replace(/^\/+|\/+$/g, '');

function defaultSpace(spaces: string[]): string {
  if (!spaces.length) return '';
  return spaces.includes('wiki') ? 'wiki' : spaces.find((s) => s !== 'personal') ?? spaces[0];
}

export type UseLibraryStateArgs = {
  open: boolean;
  initialTab?: LibraryTab;
  spaces: string[];
  flags: FeatureFlags;
  /** Vault is in `folders`/`managed` mode — no provenance roots or spaces. */
  foldersMode?: boolean;
  onUploaded: () => void;
  onClose: () => void;
  showToast: (msg: string) => void;
};

/**
 * All Library-modal state, effects, and mutation handlers. Owned by the modal
 * shell (which stays mounted while open) so every tab's state survives tab
 * switches exactly as it did when this was one 1167-line component — the tab
 * components are pure JSX over the values returned here. The four `*Ref`
 * mirrors are load-bearing: the upload chain reads post-render scope/space/
 * destination/folder in an async loop and would otherwise see stale closures.
 */
export function useLibraryState({
  open,
  initialTab,
  spaces,
  flags,
  foldersMode = false,
  onUploaded,
  onClose,
  showToast,
}: UseLibraryStateArgs) {
  const [tab, setTab] = useState<LibraryTab>(initialTab ?? 'upload');
  const [scope, setScope] = useState<Scope>('shared');
  // The nested folder tree for the active scope, fetched from /api/folders and
  // refreshed after any folder op. `spaces` (shared, from the sidebar) seeds the
  // top level so the first render shows instantly.
  const [folderTree, setFolderTree] = useState<FolderNode[]>(() =>
    spaces.map((name) => ({ name, path: name, indexed: 0, children: [] })),
  );
  const [folderNonce, setFolderNonce] = useState(0);
  const [space, setSpace] = useState(defaultSpace(spaces));
  // `raw` means "process with AI later" — that pipeline is the curate feature.
  // With curate off there's nothing to process raw files, so authored is the
  // only sensible default. Folders/managed mode also forces `authored`: a
  // `raw/` key there is excluded by `isDocumentKey`, so it is invisible to the
  // tree, search, and the read route *and* unreachable by folders-mode curate,
  // which filters its source listing through that same predicate. `/api/upload`
  // rejects `raw` in these modes; this keeps the UI from offering it.
  const [destination, setDestination] = useState<Destination>(
    flags.curate && !foldersMode ? 'raw' : 'authored',
  );
  const [folder, setFolder] = useState('');
  const [cliOpen, setCliOpen] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const topNodes = folderTree;
  const spaceList = topNodes.map((n) => n.name);
  const selectedNode = topNodes.find((n) => n.name === space) ?? null;
  const subfolderSuggestions = selectedNode ? descendantPaths(selectedNode) : [];
  const scopeIndexed = topNodes.reduce((a, n) => a + n.indexed, 0);

  // Refs for latest values (avoids stale closures in async chains)
  const scopeRef = useRef(scope);
  const spaceRef = useRef(space);
  const destinationRef = useRef(destination);
  const folderRef = useRef(folder);
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  useEffect(() => { spaceRef.current = space; }, [space]);
  useEffect(() => { destinationRef.current = destination; }, [destination]);
  useEffect(() => { folderRef.current = folder; }, [folder]);

  // Full S3 destination for the current selection — `s3://bucket/prefix/...`.
  // Shared by the inline preview and the CLI instructions so they never drift.
  // (The base is prefixed by the caller via `s3Location`; see the shell.)

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
  const [reindexMode, setReindexMode] = useState<'folder' | 'all'>('folder');
  const [reindexRunning, setReindexRunning] = useState(false);
  const [reindexDone, setReindexDone] = useState(false);
  const [reindexTotal, setReindexTotal] = useState(0);
  const [reindexIndexed, setReindexIndexed] = useState(0);
  const [reindexRawCount, setReindexRawCount] = useState(0);

  // Folders tab — nested tree editor (nodes addressed by full `a/b/c` paths)
  const [newFolder, setNewFolder] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [addingChildPath, setAddingChildPath] = useState<string | null>(null);
  const [childValue, setChildValue] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const childInputRef = useRef<HTMLInputElement>(null);

  const batchRunning = pendingRunning || reindexRunning;
  const resetFolderEdits = useCallback(() => {
    setEditingPath(null); setDeletingPath(null); setAddingChildPath(null);
  }, []);

  // Fetch the nested folder tree for the active scope. Re-runs on scope change
  // or when a folder op bumps `folderNonce`. GET /api/folders is a read path
  // (ungated), so this works even when only curate/reindex tabs are on.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetch(withBasePath(`/api/folders?scope=${scope}${scope === 'user' ? `&userId=${encodeURIComponent(DEFAULT_USER_ID)}` : ''}`), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((tree: FolderNode[]) => {
        setFolderTree(tree);
        const names = tree.map((n) => n.name);
        // Auto-expand top-level folders that have children so the tree opens
        // usefully on the Folders tab.
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const n of tree) if (n.children.length) next.add(n.path);
          return next;
        });
        // Keep the current selection if still valid; the pending tab pins its
        // own space and the reindex tab can use the synthetic `__all`.
        if (tab !== 'pending') {
          setSpace((prev) => (prev && (names.includes(prev) || prev === '__all') ? prev : defaultSpace(names)));
        }
      })
      .catch(() => { /* keep the current tree on failure */ });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, folderNonce]);

  // Reset on open
  useEffect(() => {
    if (!open) {
      // Abort any running stream on close
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    setTab(initialTab ?? 'upload');
    setScope('shared'); setDestination(flags.curate ? 'raw' : 'authored'); setFolder('');
    setFiles([]); setDragActive(false); setCliOpen(false);
    setPendingStream([]); setPendingRunning(false); setPendingDone(false); setPendingJobTotal(0); setPendingPhase(null); setPendingFinalizing(false);
    setReindexMode('folder'); setReindexRunning(false); setReindexDone(false); setReindexTotal(0); setReindexIndexed(0); setReindexRawCount(0);
    setNewFolder(''); resetFolderEdits(); setFolderBusy(false);
    // The folders effect (keyed on scope) loads the authoritative tree for the
    // reset-to-shared scope and fixes the selection.
  }, [open, initialTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch pending count when space/scope changes.
  //
  // Folders mode is skipped entirely: "pending" there is scoped to a *source*
  // folder the Library has no picker for (plan 026 shipped the API, not the UI),
  // and `/api/raw` no longer treats an absent source as the vault root. Asking
  // without one would only ever report 0, and the provenance branch's forced
  // `space = 'wiki'` below would hijack the folder selector on a vault that has
  // no `wiki` space.
  useEffect(() => {
    if (!open || foldersMode) return;
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
  }, [open, space, tab, scope, foldersMode]);

  // Escape to close — but not while an inline folder edit is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editingPath && !deletingPath && addingChildPath === null) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, editingPath, deletingPath, addingChildPath]);

  useEffect(() => { if (editingPath && editInputRef.current) editInputRef.current.select(); }, [editingPath]);
  useEffect(() => { if (addingChildPath !== null && childInputRef.current) childInputRef.current.focus(); }, [addingChildPath]);

  // Switching scope re-fetches that scope's folders → reset selection + clear subfolder.
  const switchScope = (next: Scope) => {
    if (next === scope || batchRunning) return;
    setScope(next);
    setFolder('');
    resetFolderEdits(); setNewFolder('');
  };

  const updateFile = useCallback((id: string, patch: Partial<UploadFile>) => {
    setFiles(curr => curr.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const processFile = useCallback(async (entry: UploadFile) => {
    const currentScope = scopeRef.current;
    const currentSpace = spaceRef.current;
    const currentDestination = destinationRef.current;

    // Authored uploads must land in a folder. With per-scope folders, the
    // selected scope may have none declared yet — prompt to create one.
    if (currentDestination === 'authored' && !currentSpace) {
      updateFile(entry.id, { status: 'error', error: 'Create a folder first (Folders tab)' });
      return;
    }

    updateFile(entry.id, { status: 'uploading', progress: 0 });
    const form = new FormData();
    form.append('file', entry.file);
    form.append('destination', currentDestination);
    form.append('scope', currentScope);
    if (currentScope === 'user') form.append('userId', DEFAULT_USER_ID);
    if (currentDestination === 'authored') form.append('space', currentSpace);
    const currentFolder = cleanSeg(folderRef.current);
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

  const finishUpload = () => { onUploaded(); onClose(); const n = files.filter(f => f.status === 'indexed').length; const sub = cleanSeg(folder); if (n) showToast(`Uploaded ${n} file${n > 1 ? 's' : ''} to ${space}${sub ? `/${sub}` : ''}`); };

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
  const reindexSpace = reindexMode === 'all' ? '__all' : space;
  const startReindex = async () => {
    setReindexRunning(true); setReindexDone(false); setReindexTotal(0); setReindexIndexed(0); setReindexRawCount(0);
    try {
      const res = await fetch(withBasePath('/api/reindex'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(reindexSpace === '__all' ? {} : { space: reindexSpace }), ...scopePayload() }),
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
      showToast(`Re-indexed ${reindexSpace === '__all' ? 'all folders' : reindexSpace}`);
    } catch { setReindexRunning(false); showToast('Re-index failed'); }
  };

  // ── Folders tab: nested folder create / rename / delete via /api/folders ──
  const refreshFolders = () => { setFolderNonce((n) => n + 1); onUploaded(); };

  const newFolderClean = cleanSeg(newFolder.trim().toLowerCase());
  const newFolderValid = !!newFolderClean && validPath(newFolderClean) && !findFolder(folderTree, newFolderClean.split('/'));
  const createFolderReq = async () => {
    if (!newFolderValid || folderBusy) return;
    setFolderBusy(true);
    try {
      const res = await fetch(withBasePath('/api/folders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newFolderClean, ...scopePayload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.detail || 'Could not create folder'); return; }
      setNewFolder('');
      setExpanded((s) => {
        const n = new Set(s);
        const segs = newFolderClean.split('/');
        for (let i = 1; i < segs.length; i++) n.add(segs.slice(0, i).join('/'));
        return n;
      });
      showToast(`Created folder "${newFolderClean}"`);
      refreshFolders();
    } catch { showToast('Network error'); }
    finally { setFolderBusy(false); }
  };

  const startRename = (path: string, name: string) => { resetFolderEdits(); setEditingPath(path); setEditValue(name); };
  const submitRename = async (path: string) => {
    const segs = path.split('/');
    const from = segs[segs.length - 1];
    const parentSegs = segs.slice(0, -1);
    const to = cleanSeg(editValue.trim().toLowerCase());
    if (!to || !SEG_RE.test(to) || (to !== from && childExists(folderTree, parentSegs, to))) { return; }
    if (to === from) { setEditingPath(null); return; }
    setFolderBusy(true);
    try {
      const res = await fetch(withBasePath('/api/folders'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: path, to, ...scopePayload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.detail || 'Could not rename folder'); return; }
      setEditingPath(null);
      if (segs.length === 1 && space === from) setSpace(to);
      showToast(`Renamed "${from}" → "${to}"`);
      refreshFolders();
    } catch { showToast('Network error'); }
    finally { setFolderBusy(false); }
  };

  const startAddChild = (path: string) => { resetFolderEdits(); setAddingChildPath(path); setChildValue(''); setExpanded((s) => new Set(s).add(path)); };
  const childClean = cleanSeg(childValue.trim().toLowerCase());
  const childValid = !!childClean && SEG_RE.test(childClean) && addingChildPath !== null && !childExists(folderTree, addingChildPath ? addingChildPath.split('/') : [], childClean);
  const submitAddChild = async () => {
    if (!childValid || folderBusy || addingChildPath === null) return;
    const path = `${addingChildPath}/${childClean}`;
    setFolderBusy(true);
    try {
      const res = await fetch(withBasePath('/api/folders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ...scopePayload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.detail || 'Could not create subfolder'); return; }
      setAddingChildPath(null);
      showToast(`Created folder "${path}"`);
      refreshFolders();
    } catch { showToast('Network error'); }
    finally { setFolderBusy(false); }
  };

  const submitDelete = async (path: string) => {
    setFolderBusy(true);
    try {
      const res = await fetch(withBasePath(`/api/folders?path=${encodeURIComponent(path)}${scopeQuery()}`), { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || 'Could not delete folder');
        return;
      }
      setDeletingPath(null);
      if (!path.includes('/') && space === path) setSpace(defaultSpace(spaceList.filter((s) => s !== path)));
      showToast(`Deleted folder "${path}"`);
      refreshFolders();
    } catch { showToast('Network error'); }
    finally { setFolderBusy(false); }
  };

  const toggleExpand = (key: string) => setExpanded((s) => {
    const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n;
  });

  const scopeLabel = scope === 'shared' ? 'Shared' : `My (${DEFAULT_USER_ID})`;

  return {
    // shell/shared state
    tab, setTab, scope, folderTree, space, setSpace, destination, setDestination,
    folder, setFolder, cliOpen, setCliOpen, files, dragActive, inputRef,
    topNodes, spaceList, selectedNode, subfolderSuggestions, scopeIndexed,
    scopeQuery, scopePayload, batchRunning, scopeLabel, switchScope, cleanSeg,
    // upload
    addFiles, removeFile, onDrop, onDragEnter, onDragLeave, onDragOver, onPick,
    allDone, anyActive, finishUpload,
    // pending
    foldersMode,
    pendingCount, pendingLimit, setPendingLimit, pendingJobTotal, pendingStream,
    pendingRunning, pendingDone, pendingNow, pendingPhase, pendingFinalizing,
    startPendingStream, cancelPending,
    // reindex
    reindexMode, setReindexMode, reindexRunning, reindexDone, reindexTotal,
    reindexIndexed, reindexRawCount, reindexSpace, startReindex,
    // folders
    newFolder, setNewFolder, expanded, editingPath, setEditingPath, editValue,
    setEditValue, deletingPath, setDeletingPath, addingChildPath, setAddingChildPath,
    childValue, setChildValue, folderBusy, editInputRef, childInputRef,
    resetFolderEdits, newFolderClean, newFolderValid, childValid, createFolderReq,
    startRename, submitRename, startAddChild, submitAddChild, submitDelete, toggleExpand,
  };
}

export type LibraryState = ReturnType<typeof useLibraryState>;
