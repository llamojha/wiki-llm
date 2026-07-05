'use client';

import { ICONS } from '@/lib/icons';

import type { LibraryState } from './use-library-state';

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

type UploadTabProps = {
  lib: LibraryState;
  onClose: () => void;
  /** Resolved S3 destination for the current selection; computed by the shell
   *  and shared with the inline preview so the two never drift. */
  destPath: string;
};

export function UploadTab({ lib, onClose, destPath }: UploadTabProps) {
  const {
    files, dragActive, inputRef, onDrop, onDragOver, onDragEnter, onDragLeave,
    onPick, addFiles, removeFile, cliOpen, setCliOpen, allDone, anyActive,
    finishUpload, destination, space,
  } = lib;

  return (
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
  );
}
