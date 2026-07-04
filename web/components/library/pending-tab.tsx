'use client';

import { ICONS } from '@/lib/icons';

import type { FileStage, LibraryState } from './use-library-state';

const STAGE_LABEL: Record<FileStage, string> = {
  reading: 'reading source',
  extracting: 'calling Bedrock',
  writing: 'writing pages',
  manifest: 'updating manifest',
};

type PendingTabProps = {
  lib: LibraryState;
  onClose: () => void;
};

export function PendingTab({ lib, onClose }: PendingTabProps) {
  const {
    pendingCount, pendingStream, pendingRunning, pendingDone, pendingNow,
    pendingPhase, pendingFinalizing, pendingJobTotal, pendingLimit, setPendingLimit,
    startPendingStream, cancelPending, space,
  } = lib;

  return (
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
  );
}
