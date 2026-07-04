'use client';

import { ICONS } from '@/lib/icons';

import type { LibraryState } from './use-library-state';

type ReindexTabProps = {
  lib: LibraryState;
  onClose: () => void;
};

export function ReindexTab({ lib, onClose }: ReindexTabProps) {
  const {
    reindexMode, setReindexMode, reindexRunning, reindexDone, reindexTotal,
    reindexIndexed, reindexRawCount, startReindex, space, scopeLabel,
    scopeIndexed, selectedNode,
  } = lib;

  return (
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
  );
}
