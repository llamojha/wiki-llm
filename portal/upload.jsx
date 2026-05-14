// Upload / Library modal — three tabs:
//   • Upload      — drag-drop, per-file upload + auto-index
//   • Pending     — batch-curate raw files already in S3 (streaming progress)
//   • Re-index    — rebuild index from scratch for a space
//
// Mirrors the backend surface area: POST /api/upload, POST /api/curate (stream),
// POST /api/reindex, GET /api/raw?space=X.

const { useState: uSU, useRef: uRU, useEffect: uEU } = React;

const SPACES = (window.WIKI_DATA && window.WIKI_DATA.SPACES) || [];

function UploadModal({ open, onClose, onUploaded, initialTab }) {
  const [tab, setTab] = uSU(initialTab || 'upload');
  const [space, setSpace] = uSU('platform');
  const [subpath, setSubpath] = uSU('runbooks');
  const [files, setFiles] = uSU([]);
  const [dragActive, setDragActive] = uSU(false);
  const [autoIndex, setAutoIndex] = uSU(true);
  // pending tab state
  const [pendingStream, setPendingStream] = uSU([]); // [{name, ts, status}]
  const [pendingRunning, setPendingRunning] = uSU(false);
  const [pendingDone, setPendingDone] = uSU(false);
  // reindex tab state
  const [reindexRunning, setReindexRunning] = uSU(false);
  const [reindexProgress, setReindexProgress] = uSU(0);
  const [reindexDone, setReindexDone] = uSU(false);

  const inputRef = uRU(null);
  const dragCounter = uRU(0);
  const streamRef = uRU(null);

  uEU(() => {
    if (open) {
      setTab(initialTab || 'upload');
      setFiles([]); setDragActive(false);
      setPendingStream([]); setPendingRunning(false); setPendingDone(false);
      setReindexRunning(false); setReindexProgress(0); setReindexDone(false);
    } else {
      // stop any running stream
      if (streamRef.current) { clearInterval(streamRef.current); streamRef.current = null; }
    }
  }, [open]);

  uEU(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const spaceObj = SPACES.find((s) => s.id === space) || SPACES[0] || { indexed: 0, pending: 0 };
  const totalPending = SPACES.reduce((a, s) => a + s.pending, 0);
  const totalIndexed = SPACES.reduce((a, s) => a + s.indexed, 0);

  // ── Upload tab ──
  const addFiles = (list) => {
    const incoming = Array.from(list).map((f) => ({
      id: 'u-' + Math.random().toString(36).slice(2, 8),
      name: f.name, size: f.size, type: f.type,
      status: 'queued', progress: 0,
    }));
    setFiles((curr) => [...curr, ...incoming]);
    incoming.forEach((entry, idx) => {
      let p = 0;
      const tick = setInterval(() => {
        p += 8 + Math.random() * 14;
        if (p >= 100) {
          clearInterval(tick);
          setFiles((curr) => curr.map((f) => f.id === entry.id ? { ...f, status: autoIndex ? 'indexing' : 'queued-curate', progress: 100 } : f));
          if (autoIndex) {
            setTimeout(() => {
              setFiles((curr) => curr.map((f) => f.id === entry.id ? { ...f, status: 'indexed' } : f));
            }, 700 + Math.random() * 600);
          }
        } else {
          setFiles((curr) => curr.map((f) => f.id === entry.id ? { ...f, status: 'uploading', progress: p } : f));
        }
      }, 110);
    });
  };
  const onPick = () => inputRef.current?.click();
  const onDrop = (e) => {
    e.preventDefault(); setDragActive(false); dragCounter.current = 0;
    const dropped = e.dataTransfer.files;
    if (dropped && dropped.length) addFiles(dropped);
  };
  const onDragEnter = (e) => { e.preventDefault(); dragCounter.current += 1; setDragActive(true); };
  const onDragLeave = (e) => { e.preventDefault(); dragCounter.current -= 1; if (dragCounter.current <= 0) setDragActive(false); };
  const onDragOver = (e) => { e.preventDefault(); };
  const removeFile = (id) => setFiles((curr) => curr.filter((f) => f.id !== id));

  const allDone = files.length > 0 && files.every((f) => f.status === 'indexed' || f.status === 'queued-curate');
  const anyActive = files.some((f) => f.status === 'uploading' || f.status === 'indexing' || f.status === 'queued');
  const finishUpload = () => {
    onUploaded?.({ files, space, subpath });
    onClose();
  };

  // ── Pending tab — simulate NDJSON stream from POST /api/curate ──
  const startPendingStream = () => {
    setPendingStream([]); setPendingRunning(true); setPendingDone(false);
    const sampleNames = [
      'release-notes/2026-05-12-platform.md',
      'release-notes/2026-05-12-billing.md',
      'release-notes/2026-05-11-search.md',
      'auto/runbook-postgres-vacuum.md',
      'auto/runbook-redis-failover.md',
      'auto/postmortem-2026-05-08-indexer.md',
      'auto/postmortem-2026-05-04-billing-webhook.md',
      'arch/data-pipeline-revision.md',
      'arch/auth-overview-v3.md',
      'arch/search-architecture.md',
      'team/onboarding-platform.md',
      'team/oncall-rotations-q2.md',
    ];
    const queue = sampleNames.slice(0, spaceObj.pending || 8);
    let i = 0;
    const tick = setInterval(() => {
      if (i >= queue.length) {
        clearInterval(tick); streamRef.current = null;
        setPendingRunning(false); setPendingDone(true);
        return;
      }
      const name = queue[i++];
      const now = new Date();
      const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0').slice(0, 3)}`;
      setPendingStream((curr) => [...curr, { name, ts, status: 'curating' }]);
      setTimeout(() => {
        setPendingStream((curr) => curr.map((e) => e.name === name ? { ...e, status: 'indexed', tokens: 800 + Math.floor(Math.random() * 4200) } : e));
      }, 350 + Math.random() * 350);
    }, 320);
    streamRef.current = tick;
  };
  const stopPendingStream = () => {
    if (streamRef.current) { clearInterval(streamRef.current); streamRef.current = null; }
    setPendingRunning(false);
  };

  // ── Re-index tab ──
  const startReindex = () => {
    setReindexRunning(true); setReindexProgress(0); setReindexDone(false);
    let p = 0;
    const tick = setInterval(() => {
      p += 1.5 + Math.random() * 3;
      if (p >= 100) {
        clearInterval(tick); streamRef.current = null;
        setReindexProgress(100); setReindexRunning(false); setReindexDone(true);
      } else {
        setReindexProgress(p);
      }
    }, 110);
    streamRef.current = tick;
  };

  if (!open) return null;

  const fmtSize = (b) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1024/1024).toFixed(1)} MB`;
  };

  return (
    <div className="palette-overlay" onClick={onClose} style={{ paddingTop: '7vh' }}>
      <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upload-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--accent)' }}>{ICONS.upload}</span>
            <b>Library</b>
            <span style={{ color: 'var(--fg-3)', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>{totalIndexed.toLocaleString()} indexed · {totalPending} pending</span>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">{ICONS.close}</button>
        </div>

        {/* Tabs */}
        <div className="upload-tabs">
          <button className={"upload-tab" + (tab === 'upload' ? ' on' : '')} onClick={() => setTab('upload')}>
            {ICONS.upload} Upload
          </button>
          <button className={"upload-tab" + (tab === 'pending' ? ' on' : '')} onClick={() => setTab('pending')}>
            {ICONS.spark} Pending
            {totalPending > 0 && <span className="upload-tab-badge">{totalPending}</span>}
          </button>
          <button className={"upload-tab" + (tab === 'reindex' ? ' on' : '')} onClick={() => setTab('reindex')}>
            {ICONS.recent} Re-index
          </button>
        </div>

        {/* Space selector — shared across tabs */}
        <div className="upload-meta">
          <div className="upload-meta-row">
            <label>Space</label>
            <div className="space-select">
              {SPACES.map((s) => (
                <button key={s.id} className={"space-pill" + (space === s.id ? ' on' : '')}
                        onClick={() => setSpace(s.id)}>
                  {s.kind === 'shared' ? ICONS.globe : ICONS.lock}
                  <span>{s.label}</span>
                  <span className="space-pill-counts">
                    <span className="indexed">{s.indexed}</span>
                    {s.pending > 0 && <span className="pending">+{s.pending}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {tab === 'upload' && (
            <>
              <div className="upload-meta-row">
                <label>Path</label>
                <input className="upload-input" value={subpath} onChange={(e) => setSubpath(e.target.value)}
                       placeholder="e.g. runbooks"/>
              </div>
              <div className="upload-s3-preview">
                {ICONS.s3}
                <span>s3://wikillm/tenants/acme/{spaceObj.kind === 'shared' ? `shared/${space}` : `users/u-1042/wiki`}/{subpath.replace(/^\/|\/$/g, '')}/</span>
              </div>
            </>
          )}
        </div>

        {/* Tab body */}
        {tab === 'upload' && (
          <>
            <div className={"upload-drop" + (dragActive ? ' active' : '') + (files.length ? ' compact' : '')}
                 onDrop={onDrop} onDragOver={onDragOver}
                 onDragEnter={onDragEnter} onDragLeave={onDragLeave}
                 onClick={files.length ? undefined : onPick}>
              <input ref={inputRef} type="file" multiple
                     accept=".md,.markdown,text/markdown"
                     onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                     style={{ display: 'none' }}/>
              {files.length === 0 ? (
                <div className="upload-drop-inner">
                  <div className="upload-drop-icon">{ICONS.upload}</div>
                  <div className="upload-drop-title">Drag Markdown files here</div>
                  <div className="upload-drop-sub">or <a onClick={(e) => { e.stopPropagation(); onPick(); }}>browse</a> from your computer</div>
                  <div className="upload-drop-hint">
                    <span className="kbd">.md</span><span className="kbd">.markdown</span>
                    <span style={{ color: 'var(--fg-3)' }}>up to 25 MB each</span>
                  </div>
                </div>
              ) : (
                <div className="upload-drop-compact">
                  <span>{ICONS.upload}</span>
                  <span>Drop more files or</span>
                  <button className="btn ghost" onClick={(e) => { e.stopPropagation(); onPick(); }}>browse</button>
                </div>
              )}
            </div>

            {files.length > 0 && (
              <div className="upload-list">
                {files.map((f) => (
                  <div key={f.id} className={"upload-row " + f.status}>
                    <span className="upload-row-icon">{ICONS.file}</span>
                    <div className="upload-row-body">
                      <div className="upload-row-title">
                        <span className="upload-row-name">{f.name}</span>
                        <span className="upload-row-size">{fmtSize(f.size)}</span>
                      </div>
                      <div className="upload-row-status">
                        {f.status === 'queued' && <span>queued…</span>}
                        {f.status === 'uploading' && (
                          <>
                            <span>uploading to S3</span>
                            <span className="upload-row-pct">{Math.round(f.progress)}%</span>
                          </>
                        )}
                        {f.status === 'indexing' && (
                          <>
                            <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }}></span>
                            <span>indexing into OpenSearch</span>
                          </>
                        )}
                        {f.status === 'queued-curate' && (
                          <>
                            <span style={{ color: 'var(--amber)' }}>●</span>
                            <span>uploaded · curate via "Pending" tab</span>
                          </>
                        )}
                        {f.status === 'indexed' && (
                          <>
                            <span style={{ color: 'var(--green)' }}>{ICONS.check}</span>
                            <span style={{ color: 'var(--green)' }}>indexed · searchable</span>
                          </>
                        )}
                      </div>
                      {(f.status === 'uploading' || f.status === 'indexing') && (
                        <div className="upload-row-bar">
                          <div className="upload-row-bar-fill" style={{ width: (f.status === 'indexing' ? 100 : f.progress) + '%' }}></div>
                        </div>
                      )}
                    </div>
                    <button className="upload-row-x" onClick={() => removeFile(f.id)} title="Remove">{ICONS.trash}</button>
                  </div>
                ))}
              </div>
            )}

            <div className="upload-foot">
              <label className="upload-check">
                <input type="checkbox" checked={autoIndex} onChange={(e) => setAutoIndex(e.target.checked)}/>
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

        {tab === 'pending' && (
          <>
            <div className="pending-summary">
              <div className="pending-stat">
                <div className="pending-stat-value">{spaceObj.pending}</div>
                <div className="pending-stat-label">raw files in <code>{space}</code></div>
              </div>
              <div className="pending-stat">
                <div className="pending-stat-value">{spaceObj.indexed.toLocaleString()}</div>
                <div className="pending-stat-label">already indexed</div>
              </div>
              <div style={{ flex: 1 }}></div>
              <div className="pending-route">
                <code>POST /api/curate?space={space}&amp;stream=1</code>
              </div>
            </div>

            <div className="upload-list pending-stream">
              {pendingStream.length === 0 && !pendingRunning && (
                <div className="pending-empty">
                  <div className="upload-drop-icon" style={{ margin: '0 auto 12px' }}>{ICONS.spark}</div>
                  <div className="upload-drop-title">Process pending raw files</div>
                  <div className="upload-drop-sub">
                    {spaceObj.pending} file{spaceObj.pending === 1 ? '' : 's'} have landed in S3 but haven't been curated yet.
                  </div>
                  <div className="upload-drop-hint">
                    <span style={{ color: 'var(--fg-3)' }}>The curator parses frontmatter, tokenizes, and pushes into OpenSearch.</span>
                  </div>
                </div>
              )}
              {pendingStream.map((e, i) => (
                <div key={i} className={"stream-line " + e.status}>
                  <span className="stream-ts">{e.ts}</span>
                  <span className="stream-arrow">{e.status === 'indexed' ? ICONS.check : '·'}</span>
                  <span className="stream-name">{e.name}</span>
                  {e.status === 'indexed' && <span className="stream-tokens">{e.tokens.toLocaleString()} tok</span>}
                  {e.status === 'curating' && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }}></span>}
                </div>
              ))}
            </div>

            <div className="upload-foot">
              <span className="upload-summary">
                {!pendingRunning && !pendingDone && (spaceObj.pending === 0
                  ? 'Nothing pending'
                  : `${spaceObj.pending} file${spaceObj.pending > 1 ? 's' : ''} pending`)}
                {pendingRunning && `${pendingStream.filter(e => e.status === 'indexed').length} of ${spaceObj.pending} done`}
                {pendingDone && `${pendingStream.length} curated · searchable now`}
              </span>
              <span style={{ flex: 1 }}></span>
              <button className="btn ghost" onClick={onClose}>Close</button>
              {!pendingRunning ? (
                <button className="btn primary" disabled={spaceObj.pending === 0} onClick={startPendingStream}>
                  {ICONS.spark} {pendingDone ? 'Run again' : 'Process all'}
                </button>
              ) : (
                <button className="btn" onClick={stopPendingStream}>
                  Stop
                </button>
              )}
            </div>
          </>
        )}

        {tab === 'reindex' && (
          <div className="reindex-panel">
            <div className="callout warn" style={{ margin: 0 }}>
              <span className="icon">{ICONS.warn}</span>
              <div>
                <div><strong>Re-index the <code>{space}</code> space</strong> from raw S3 content.</div>
                <div style={{ marginTop: 4, color: 'var(--fg-2)' }}>The OpenSearch index for this space will be torn down and rebuilt. Search results may be temporarily incomplete during the rebuild.</div>
              </div>
            </div>

            <div className="reindex-stats">
              <div>
                <div className="reindex-stat-label">Will reprocess</div>
                <div className="reindex-stat-value">{(spaceObj.indexed + spaceObj.pending).toLocaleString()} <span style={{ color: 'var(--fg-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>files</span></div>
              </div>
              <div>
                <div className="reindex-stat-label">Estimated time</div>
                <div className="reindex-stat-value">~{Math.max(1, Math.round((spaceObj.indexed + spaceObj.pending) / 60))}m</div>
              </div>
              <div>
                <div className="reindex-stat-label">Endpoint</div>
                <code style={{ fontSize: 11 }}>POST /api/reindex</code>
              </div>
            </div>

            {(reindexRunning || reindexDone) && (
              <div className="reindex-progress">
                <div className="reindex-progress-bar">
                  <div className="reindex-progress-fill" style={{ width: reindexProgress + '%' }}></div>
                </div>
                <div className="reindex-progress-text">
                  {reindexDone ? (
                    <><span style={{ color: 'var(--green)' }}>{ICONS.check}</span> Re-index complete · {(spaceObj.indexed + spaceObj.pending).toLocaleString()} files indexed</>
                  ) : (
                    <>Rebuilding index · {Math.round(reindexProgress)}%</>
                  )}
                </div>
              </div>
            )}

            <div className="upload-foot" style={{ marginTop: 'auto' }}>
              <span style={{ flex: 1 }}></span>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              {!reindexDone ? (
                <button className="btn primary" disabled={reindexRunning} onClick={startReindex}>
                  {reindexRunning ? <><span className="spinner" style={{ width: 12, height: 12 }}></span> Re-indexing…</> : <>{ICONS.recent} Re-index space</>}
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

window.UploadModal = UploadModal;
