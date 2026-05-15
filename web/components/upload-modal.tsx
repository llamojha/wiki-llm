'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ICONS } from '@/lib/icons';

export type LibraryTab = 'upload' | 'pending' | 'reindex';

type UploadModalProps = {
  open: boolean;
  initialTab?: LibraryTab;
  spaces: string[];
  onClose: () => void;
  onUploaded: () => void;
  showToast: (msg: string) => void;
};

type FileStatus = 'queued' | 'uploading' | 'indexing' | 'indexed' | 'queued-curate' | 'error';
type UploadFile = { id: string; name: string; size: number; file: File; status: FileStatus; progress: number; error?: string };
type StreamLine = { name: string; ts: string; status: 'curating' | 'indexed' };

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadModal({ open, initialTab, spaces, onClose, onUploaded, showToast }: UploadModalProps) {
  const [tab, setTab] = useState<LibraryTab>(initialTab ?? 'upload');
  const [space, setSpace] = useState(spaces[0] ?? 'articles');
  const [subpath, setSubpath] = useState<'raw' | 'wiki'>('raw');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [autoIndex, setAutoIndex] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // Refs for latest values (avoids stale closures in async chains)
  const spaceRef = useRef(space);
  const autoIndexRef = useRef(autoIndex);
  const subpathRef = useRef(subpath);
  useEffect(() => { spaceRef.current = space; }, [space]);
  useEffect(() => { autoIndexRef.current = autoIndex; }, [autoIndex]);
  useEffect(() => { subpathRef.current = subpath; }, [subpath]);

  // Pending tab
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingStream, setPendingStream] = useState<StreamLine[]>([]);
  const [pendingRunning, setPendingRunning] = useState(false);
  const [pendingDone, setPendingDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reindex tab
  const [reindexRunning, setReindexRunning] = useState(false);
  const [reindexDone, setReindexDone] = useState(false);
  const [reindexTotal, setReindexTotal] = useState(0);
  const [reindexIndexed, setReindexIndexed] = useState(0);
  const [reindexRawCount, setReindexRawCount] = useState(0);

  // Reset on open
  useEffect(() => {
    if (!open) {
      // Abort any running stream on close
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    setTab(initialTab ?? 'upload');
    setFiles([]); setDragActive(false);
    setPendingStream([]); setPendingRunning(false); setPendingDone(false);
    setReindexRunning(false); setReindexDone(false); setReindexTotal(0); setReindexIndexed(0); setReindexRawCount(0);
    if (spaces.length && !spaces.includes(space)) setSpace(spaces[0]);
  }, [open, initialTab]);

  // Fetch pending count when space changes
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetch(`/api/raw?space=${encodeURIComponent(space)}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => setPendingCount(d.count ?? 0))
      .catch(() => { if (!ctrl.signal.aborted) setPendingCount(0); });
    return () => ctrl.abort();
  }, [open, space]);

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
    const currentSpace = spaceRef.current;
    const currentAutoIndex = autoIndexRef.current;
    const currentSubpath = subpathRef.current;

    updateFile(entry.id, { status: 'uploading', progress: 0 });
    const form = new FormData();
    form.append('file', entry.file);
    form.append('space', currentSpace);
    form.append('path', currentSubpath);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: 'Upload failed' }));
        updateFile(entry.id, { status: 'error', error: data.detail || 'Upload failed' });
        return;
      }
      let key: string;
      try {
        const json = await res.json();
        key = json.key;
      } catch {
        updateFile(entry.id, { status: 'error', error: 'Invalid response' });
        return;
      }
      updateFile(entry.id, { status: 'uploading', progress: 100 });

      if (currentAutoIndex) {
        updateFile(entry.id, { status: 'indexing', progress: 100 });
        const curateRes = await fetch('/api/curate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ space: currentSpace, key }),
        });
        if (!curateRes.ok) { updateFile(entry.id, { status: 'error', error: 'Indexing failed' }); return; }
        updateFile(entry.id, { status: 'indexed' });
      } else {
        updateFile(entry.id, { status: 'queued-curate' });
      }
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

  const finishUpload = () => { onUploaded(); onClose(); const n = files.filter(f => f.status === 'indexed').length; if (n) showToast(`Uploaded ${n} file${n > 1 ? 's' : ''} to ${space}`); };

  // ── Pending tab: stream curate ──
  const startPendingStream = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPendingStream([]); setPendingRunning(true); setPendingDone(false);
    try {
      const res = await fetch('/api/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space, stream: true }),
        signal: ctrl.signal,
      });
      if (!res.ok) { setPendingRunning(false); showToast('No pending files or error'); return; }
      const reader = res.body?.getReader();
      if (!reader) { setPendingRunning(false); return; }
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'progress') {
              const name = msg.rawKey.split('/').slice(-1)[0] ?? msg.rawKey;
              const now = new Date();
              const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
              setPendingStream(curr => [...curr, { name, ts, status: msg.error ? 'curating' : 'indexed' }]);
            }
          } catch { /* skip malformed */ }
        }
      }
      setPendingRunning(false); setPendingDone(true);
      onUploaded();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setPendingRunning(false); showToast('Processing failed');
    }
  };

  // ── Re-index tab ──
  const startReindex = async () => {
    setReindexRunning(true); setReindexDone(false); setReindexTotal(0); setReindexIndexed(0); setReindexRawCount(0);
    try {
      const res = await fetch('/api/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(space === '__all' ? {} : { space }),
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

        {/* Tabs */}
        <div className="upload-tabs">
          <button className={'upload-tab' + (tab === 'upload' ? ' on' : '')} onClick={() => setTab('upload')}>
            {ICONS.upload} Upload
          </button>
          <button className={'upload-tab' + (tab === 'pending' ? ' on' : '')} onClick={() => setTab('pending')}>
            {ICONS.spark} Pending
            {pendingCount > 0 && <span className="upload-tab-badge">{pendingCount}</span>}
          </button>
          <button className={'upload-tab' + (tab === 'reindex' ? ' on' : '')} onClick={() => setTab('reindex')}>
            {ICONS.recent} Re-index
          </button>
        </div>

        {/* Space selector */}
        <div className="upload-meta">
          <div className="upload-meta-row">
            <label>Space</label>
            <div className="space-select">
              {(tab === 'reindex' || tab === 'pending') && (
                <button className={'space-pill' + (space === '__all' ? ' on' : '')} onClick={() => setSpace('__all')}>
                  {ICONS.globe}
                  <span>All</span>
                </button>
              )}
              {spaces.map(s => (
                <button key={s} className={'space-pill' + (space === s ? ' on' : '')} onClick={() => setSpace(s)}>
                  {ICONS.globe}
                  <span>{s}</span>
                </button>
              ))}
            </div>
          </div>
          {tab === 'upload' && (
            <div className="upload-meta-row">
              <label>Path</label>
              <div className="space-select">
                <button className={'space-pill' + (subpath === 'raw' ? ' on' : '')} onClick={() => setSubpath('raw')}>
                  <span>raw/</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>AI ingest</span>
                </button>
                <button className={'space-pill' + (subpath === 'wiki' ? ' on' : '')} onClick={() => setSubpath('wiki')}>
                  <span>wiki/</span>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>direct</span>
                </button>
              </div>
            </div>
          )}
          <div className="upload-s3-preview">
            {ICONS.s3}
            <span>s3://vaultmark/{space}/{subpath}/</span>
          </div>
        </div>

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
              <label className="upload-check">
                <input type="checkbox" checked={autoIndex} onChange={e => setAutoIndex(e.target.checked)}/>
                <span>Auto-index after upload</span>
              </label>
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
              <div className="pending-route"><code>POST /api/curate</code></div>
            </div>

            <div className="upload-list pending-stream">
              {pendingStream.length === 0 && !pendingRunning && (
                <div className="pending-empty">
                  <div className="upload-drop-icon" style={{ margin: '0 auto 12px' }}>{ICONS.spark}</div>
                  <div className="upload-drop-title">Process pending raw files</div>
                  <div className="upload-drop-sub">
                    {pendingCount} file{pendingCount === 1 ? '' : 's'} in <code>{space}/raw/</code> waiting to be curated.
                  </div>
                </div>
              )}
              {pendingStream.map((e, i) => (
                <div key={i} className={'stream-line ' + e.status}>
                  <span className="stream-ts">{e.ts}</span>
                  <span className="stream-arrow">{e.status === 'indexed' ? ICONS.check : '·'}</span>
                  <span className="stream-name">{e.name}</span>
                  {e.status === 'curating' && <span className="spinner"></span>}
                </div>
              ))}
            </div>

            <div className="upload-foot">
              <span className="upload-summary">
                {!pendingRunning && !pendingDone && (pendingCount === 0 ? 'Nothing pending' : `${pendingCount} file${pendingCount > 1 ? 's' : ''} pending`)}
                {pendingRunning && `${pendingStream.filter(e => e.status === 'indexed').length} of ${pendingCount} done`}
                {pendingDone && `${pendingStream.length} curated · searchable now`}
              </span>
              <span style={{ flex: 1 }}></span>
              <button className="btn ghost" onClick={onClose}>Close</button>
              {!pendingRunning ? (
                <button className="btn primary" disabled={pendingCount === 0} onClick={startPendingStream}>
                  {ICONS.spark} {pendingDone ? 'Run again' : 'Process all'}
                </button>
              ) : (
                <button className="btn" onClick={() => { abortRef.current?.abort(); setPendingRunning(false); }}>
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
      </div>
    </div>
  );
}
