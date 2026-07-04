'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ICONS } from '@/lib/icons';
import { withBasePath } from '@/lib/base-path';
import {
  type FolderNode,
  SEG_RE,
  childExists,
  countFolders,
  descendantPaths,
  findFolder,
  validPath,
} from '@/lib/folder-tree';
import { DEFAULT_USER_ID } from '@/lib/vault-paths';
import type { FeatureFlags } from '@/lib/flags';

export type LibraryTab = 'upload' | 'pending' | 'reindex' | 'folders';

type Scope = 'shared' | 'user';

type UploadModalProps = {
  open: boolean;
  initialTab?: LibraryTab;
  /** Shared top-level folder names — seeds the first render before the
   * scope-aware /api/folders fetch resolves. */
  spaces: string[];
  onClose: () => void;
  onUploaded: () => void;
  showToast: (msg: string) => void;
  flags: FeatureFlags;
  /** Resolved S3 destination base (`s3://bucket/prefix/`) from the server. */
  s3Location: string;
};

const cleanSeg = (s: string): string => s.trim().replace(/^\/+|\/+$/g, '');

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
  if (!spaces.length) return '';
  return spaces.includes('wiki') ? 'wiki' : spaces.find((s) => s !== 'personal') ?? spaces[0];
}

export function UploadModal({ open, initialTab, spaces, onClose, onUploaded, showToast, flags, s3Location }: UploadModalProps) {
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
  // only sensible default.
  const [destination, setDestination] = useState<Destination>(flags.curate ? 'raw' : 'authored');
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
  const destPath =
    s3Location +
    (scope === 'user' ? `users/${DEFAULT_USER_ID}/` : '') +
    (destination === 'raw' ? 'raw/' : `authored/${space || '<folder>'}/`) +
    (cleanSeg(folder) ? `${cleanSeg(folder)}/` : '');

  // Build the scope-bearing query string fragment used by GETs.
  const scopeQuery = (s: Scope = scope): string =>
    s === 'user' ? `&scope=user&userId=${encodeURIComponent(DEFAULT_USER_ID)}` : '';
  // Build the scope payload used by POSTs.
  const scopePayload = (s: Scope = scope): Record<string, string> =>
    s === 'user' ? { scope: 'user', userId: DEFAULT_USER_ID } : { scope: 'shared' };

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

  if (!open) return null;

  const scopeLabel = scope === 'shared' ? 'Shared' : `My (${DEFAULT_USER_ID})`;

  // Recursive folder-tree row (Folders tab)
  const renderNode = (node: FolderNode): React.ReactNode => {
    const key = node.path;
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(key);
    const isEditing = editingPath === key;
    const isDeleting = deletingPath === key;
    return (
      <div key={key} className="folder-node">
        <div className={'folder-item' + (isDeleting ? ' is-deleting' : '')}>
          <button
            className={'folder-twist' + (isOpen ? ' open' : '') + (hasChildren ? '' : ' leaf')}
            onClick={() => hasChildren && toggleExpand(key)}
            tabIndex={hasChildren ? 0 : -1}
            title={hasChildren ? (isOpen ? 'Collapse' : 'Expand') : undefined}
          >
            {hasChildren ? ICONS.chev : null}
          </button>
          <span className="folder-item-icon">{ICONS.folder}</span>
          {isEditing ? (
            <>
              <input ref={editInputRef} className="upload-input" value={editValue}
                     disabled={folderBusy}
                     onChange={(e) => setEditValue(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') submitRename(key); if (e.key === 'Escape') setEditingPath(null); }}
                     style={{ flex: 1 }} />
              <div className="folder-item-actions">
                <button className="icon-btn" disabled={folderBusy} onClick={() => submitRename(key)} title="Confirm">{ICONS.check}</button>
                <button className="btn ghost" disabled={folderBusy} onClick={() => setEditingPath(null)}>Cancel</button>
              </div>
            </>
          ) : isDeleting ? (
            <>
              <div className="folder-item-body">
                <div className="folder-item-name" style={{ color: 'var(--red)' }}>Delete <code>{key}</code> and everything inside?</div>
              </div>
              <div className="folder-item-actions">
                <button className="btn danger" disabled={folderBusy} onClick={() => submitDelete(key)}>{ICONS.trash} Delete</button>
                <button className="btn ghost" disabled={folderBusy} onClick={() => setDeletingPath(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div className="folder-item-body">
                <div className="folder-item-name">{node.name}</div>
                <div className="folder-item-path">authored/{key}/{node.indexed ? ` · ${node.indexed} indexed` : ''}</div>
              </div>
              <div className="folder-item-actions">
                <button className="icon-btn" disabled={folderBusy} onClick={() => startAddChild(key)} title="Add subfolder">{ICONS.plus}</button>
                <button className="icon-btn" disabled={folderBusy} onClick={() => startRename(key, node.name)} title="Rename">{ICONS.edit}</button>
                <button className="icon-btn danger" disabled={folderBusy} onClick={() => { resetFolderEdits(); setDeletingPath(key); }} title="Delete">{ICONS.trash}</button>
              </div>
            </>
          )}
        </div>
        {(isOpen || addingChildPath === key) && (
          <div className="folder-children">
            {node.children.map((c) => renderNode(c))}
            {addingChildPath === key && (
              <div className="folder-item folder-item-new">
                <span className="folder-twist leaf"></span>
                <span className="folder-item-icon">{ICONS.folder}</span>
                <input ref={childInputRef} className="upload-input" value={childValue}
                       disabled={folderBusy}
                       onChange={(e) => setChildValue(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter') submitAddChild(); if (e.key === 'Escape') setAddingChildPath(null); }}
                       placeholder={`new subfolder in ${node.name}`} style={{ flex: 1 }} />
                <div className="folder-item-actions">
                  <button className="icon-btn" disabled={!childValid || folderBusy} onClick={submitAddChild} title="Create">{ICONS.check}</button>
                  <button className="btn ghost" disabled={folderBusy} onClick={() => setAddingChildPath(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="palette-overlay" onClick={onClose} style={{ paddingTop: '6vh' }}>
      <div className="upload-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="upload-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--accent)' }}>{ICONS.upload}</span>
            <b>Library</b>
            <span style={{ color: 'var(--fg-3)', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
              {scopeIndexed.toLocaleString()} indexed · {pendingCount} pending
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">{ICONS.close}</button>
        </div>

        {/* Scope toggle — every operation in this modal (including folder
            management) is bound to the selected scope. Each scope owns its
            folders independently. */}
        <div className="upload-scope">
          <label>Scope</label>
          <div className="seg">
            <button
              className={scope === 'shared' ? 'on' : ''}
              disabled={batchRunning}
              onClick={() => switchScope('shared')}
              title="Shared library — visible to everyone in a multi-tenant deployment"
            >
              {ICONS.globe} Shared
            </button>
            <button
              className={scope === 'user' ? 'on' : ''}
              disabled={batchRunning}
              onClick={() => switchScope('user')}
              title="My library — isolated to this user's subtree"
            >
              {ICONS.user} My ({DEFAULT_USER_ID})
            </button>
          </div>
          <span className="upload-scope-hint">{scope === 'shared' ? 'Visible to everyone' : 'Private to you'}</span>
        </div>

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

        {/* Folder selector — shared by Upload / Pending / Re-index; hidden on the
            Folders tab, which manages folders directly. */}
        {tab !== 'folders' && (
          <div className="upload-meta">
            <div className="upload-meta-row">
              <label>Folder</label>
              <div className="space-select">
                {tab === 'pending' ? (
                  <button className="space-pill on" onClick={() => setSpace('wiki')}>
                    {ICONS.folder}
                    <span>wiki</span>
                  </button>
                ) : (
                  spaceList.map(s => {
                    const node = topNodes.find((n) => n.name === s);
                    return (
                      <button key={s} className={'space-pill' + (space === s ? ' on' : '')} onClick={() => { setSpace(s); setFolder(''); }}>
                        {ICONS.folder}
                        <span>{s}</span>
                        {node && node.indexed > 0 && (
                          <span className="space-pill-counts"><span className="indexed">{node.indexed}</span></span>
                        )}
                      </button>
                    );
                  })
                )}
                {tab !== 'pending' && spaceList.length === 0 && (
                  <span className="upload-inline-empty">No folders in this scope — create one in the Folders tab.</span>
                )}
              </div>
            </div>

            {tab === 'upload' && (
              <>
                {/* Destination toggle only matters when curate is on. Without it,
                    raw uploads can never be processed, so authored is the only
                    choice and the toggle is hidden. */}
                {flags.curate && (
                  <div className="upload-meta-row">
                    <label>Destination</label>
                    <div className="seg">
                      <button className={destination === 'authored' ? 'on' : ''} onClick={() => setDestination('authored')}>
                        {ICONS.check} authored · indexed
                      </button>
                      <button className={destination === 'raw' ? 'on' : ''} onClick={() => setDestination('raw')}>
                        {ICONS.spark} raw · curate later
                      </button>
                    </div>
                  </div>
                )}
                <div className="upload-meta-row">
                  <label>Subfolder</label>
                  <input className="upload-input" list="subfolder-suggestions" value={folder}
                         placeholder="optional · e.g. guides/setup"
                         onChange={(e) => setFolder(e.target.value)} />
                  <datalist id="subfolder-suggestions">
                    {subfolderSuggestions.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <div className="upload-s3-preview">
                  {ICONS.s3}
                  <span>{destPath}</span>
                </div>
              </>
            )}
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
                     style={{ display: 'none' }} />
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

            {/* CLI handoff — same destination, ready to run */}
            <div className="cli-handoff">
              <button className={'cli-toggle' + (cliOpen ? ' open' : '')} onClick={() => setCliOpen(v => !v)}>
                <span className="chev-i">{ICONS.chev}</span>
                <span>Prefer the CLI? Upload straight to S3</span>
                <span style={{ flex: 1 }}></span>
                <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>same destination</span>
              </button>
              {cliOpen && (
                <div className="cli-body">
                  <div className="cli-snippet"><span className="cmt"># one file → the resolved destination above</span>{'\n'}aws s3 cp ./your-file.md &quot;{destPath}&quot;</div>
                  <div className="cli-snippet"><span className="cmt"># …or a whole folder of Markdown (then run Re-index to make it searchable)</span>{'\n'}aws s3 sync ./docs/ &quot;{destPath}&quot; --exclude &quot;*&quot; --include &quot;*.md&quot;</div>
                  <div className="cli-snippet"><span className="cmt"># project CLI — uploads {destination === 'raw' ? '+ runs AI ingest' : 'only'}</span>{'\n'}pnpm ingest -- add ./your-file.md --space {space || '<folder>'}{destination === 'authored' ? ' --no-ingest' : ''}</div>
                </div>
              )}
            </div>

            <div className="upload-foot">
              <span className="upload-summary">
                {files.length === 0 && 'No files selected'}
                {files.length > 0 && anyActive && `${files.filter(f => f.status === 'indexed').length} of ${files.length} indexed`}
                {files.length > 0 && allDone && `${files.length} file${files.length > 1 ? 's' : ''} ready`}
              </span>
              <span style={{ flex: 1 }}></span>
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
              <div className="stream-line" style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-2)' }}>
                <span className="spinner"></span>
                <span style={{ marginLeft: 8 }}>
                  Continuing in a new worker — batch is being handed off to avoid the 5-minute Lambda timeout…
                </span>
              </div>
            )}
            {pendingFinalizing && (
              <div className="stream-line" style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-2)' }}>
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
                <button className="btn primary" disabled={pendingCount === 0 || pendingFinalizing} onClick={startPendingStream}>
                  {ICONS.spark} {pendingDone ? 'Run again' : 'Process batch'}
                </button>
              ) : (
                <button className="btn" onClick={cancelPending}>Stop</button>
              )}
            </div>
          </>
        )}

        {/* Re-index tab */}
        {tab === 'reindex' && (
          <div className="reindex-panel">
            <div className="upload-meta-row" style={{ gridTemplateColumns: '90px 1fr', alignItems: 'center' }}>
              <label>Rebuild</label>
              <div className="seg">
                <button className={reindexMode === 'folder' ? 'on' : ''} disabled={reindexRunning} onClick={() => setReindexMode('folder')}>
                  {ICONS.folder} This folder
                </button>
                <button className={reindexMode === 'all' ? 'on' : ''} disabled={reindexRunning} onClick={() => setReindexMode('all')}>
                  {ICONS.globe} All in {scopeLabel}
                </button>
              </div>
            </div>

            <div className="callout warn" style={{ margin: 0 }}>
              <span className="icon">{ICONS.warn}</span>
              <div>
                <div><strong>Re-index {reindexMode === 'all' ? `the ${scopeLabel} library` : <>the <code>{space}</code> folder</>}</strong> from S3 content.</div>
                <div style={{ marginTop: 4, color: 'var(--fg-2)' }}>The index will be rebuilt. Search results may be temporarily incomplete during the rebuild.</div>
              </div>
            </div>

            <div className="reindex-stats">
              <div>
                <div className="reindex-stat-label">Indexed now</div>
                <div className="reindex-stat-value">
                  {(reindexMode === 'all' ? scopeIndexed : selectedNode?.indexed ?? 0).toLocaleString()}{' '}
                  <span style={{ color: 'var(--fg-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>docs</span>
                </div>
              </div>
              <div>
                <div className="reindex-stat-label">Scope</div>
                <div className="reindex-stat-value" style={{ fontSize: 14 }}>{scopeLabel}</div>
              </div>
              <div>
                <div className="reindex-stat-label">Endpoint</div>
                <code style={{ fontSize: 11 }}>POST /api/reindex</code>
              </div>
            </div>

            {(reindexRunning || reindexDone) && (
              <div className="reindex-progress">
                {reindexTotal > 0 && (
                  <div className="reindex-progress-bar">
                    <div className="reindex-progress-fill" style={{ width: (reindexTotal ? (reindexIndexed / reindexTotal) * 100 : 0) + '%' }}></div>
                  </div>
                )}
                <div className="reindex-progress-text">
                  {reindexDone
                    ? <><span style={{ color: 'var(--green, #22c55e)' }}>{ICONS.check}</span> Re-index complete · {reindexIndexed} files</>
                    : <><span className="spinner"></span> Indexing {reindexIndexed} / {reindexTotal}</>
                  }
                </div>
                {reindexRawCount > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                    {reindexRawCount} file{reindexRawCount !== 1 ? 's' : ''} in <code>raw/</code> not yet processed
                  </div>
                )}
              </div>
            )}

            <div className="upload-foot" style={{ marginTop: 'auto' }}>
              <span style={{ flex: 1 }}></span>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              {!reindexDone ? (
                <button className="btn primary" disabled={reindexRunning || (reindexMode === 'folder' && !space)} onClick={startReindex}>
                  {reindexRunning ? <><span className="spinner"></span> Re-indexing…</> : <>{ICONS.recent} Re-index</>}
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
            <div className="folder-mgr">
              <div className="upload-meta-row" style={{ gridTemplateColumns: '90px 1fr auto', alignItems: 'center' }}>
                <label>New folder</label>
                <input className="upload-input" value={newFolder}
                       disabled={folderBusy}
                       placeholder="handbook  ·  or nested:  handbook/onboarding"
                       onChange={(e) => setNewFolder(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter') createFolderReq(); }} />
                <button className="btn primary" disabled={!newFolderValid || folderBusy} onClick={createFolderReq}>
                  {ICONS.plus} Create
                </button>
              </div>
              <div className="upload-s3-preview" style={{ marginLeft: 0 }}>
                {ICONS.s3}
                <span>{s3Location}{scope === 'user' ? `users/${DEFAULT_USER_ID}/` : ''}authored/{newFolderClean || '<folder>'}/</span>
              </div>

              <div className="callout warn" style={{ margin: 0 }}>
                <span className="icon">{ICONS.warn}</span>
                <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                  Folders are managed per scope — these changes affect only the{' '}
                  <strong>{scopeLabel}</strong> library. Deleting a folder removes{' '}
                  <strong>every document and subfolder inside it</strong>. Type a path like <code>a/b</code> to
                  nest, or use the <span style={{ display: 'inline-flex', verticalAlign: 'middle', color: 'var(--fg-2)' }}>{ICONS.plus}</span> on any row to add a subfolder.
                </div>
              </div>

              <div className="folder-list">
                {topNodes.length === 0 && (
                  <div className="folder-empty">
                    <div className="upload-drop-icon" style={{ margin: '0 auto 12px' }}>{ICONS.folder}</div>
                    <div className="upload-drop-title">No folders yet</div>
                    <div className="upload-drop-sub">Create one above to start organizing authored documents.</div>
                  </div>
                )}
                {topNodes.map((n) => renderNode(n))}
              </div>
            </div>

            <div className="upload-foot">
              <span className="upload-summary">{countFolders(topNodes)} folder{countFolders(topNodes) === 1 ? '' : 's'} in {scopeLabel}</span>
              <span style={{ flex: 1 }}></span>
              <button className="btn primary" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
