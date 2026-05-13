'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ICONS } from '@/lib/icons';

type UploadPanelProps = {
  open: boolean;
  onClose: () => void;
  spaces: string[];
  onComplete: () => void;
  showToast: (msg: string) => void;
};

type Stage = 'idle' | 'uploading' | 'uploaded' | 'processing' | 'reindexing' | 'error';

export function UploadPanel({ open, onClose, spaces, onComplete, showToast }: UploadPanelProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [space, setSpace] = useState(spaces[0] ?? '');
  const [uploadedKey, setUploadedKey] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [rawCount, setRawCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number; file: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch pending raw count when panel opens or space changes
  useEffect(() => {
    if (!open || !space) { setRawCount(null); return; }
    fetch(`/api/raw?space=${encodeURIComponent(space)}`)
      .then((r) => r.json())
      .then((d) => setRawCount(d.count ?? 0))
      .catch(() => setRawCount(null));
  }, [open, space]);

  const reset = () => {
    setStage('idle');
    setUploadedKey('');
    setFileName('');
    setError('');
    setDragOver(false);
    setProgress(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const upload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.md')) {
      setError('Only .md files are accepted');
      setStage('error');
      return;
    }
    setFileName(file.name);
    setStage('uploading');
    setError('');

    const form = new FormData();
    form.append('file', file);
    form.append('space', space);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(data.detail || 'Upload failed');
      }
      const { key } = await res.json();
      setUploadedKey(key);
      setStage('uploaded');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setStage('error');
    }
  }, [space]);

  const curate = async (key?: string) => {
    setStage('processing');
    setError('');
    setProgress(null);

    try {
      const body: Record<string, string | boolean> = { space, stream: true };
      if (key) body.key = key;

      const res = await fetch('/api/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: 'Processing failed' }));
        throw new Error(data.detail || 'Processing failed');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let totalPages = 0;

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
              setProgress({ current: msg.index, total: msg.total, file: msg.rawKey.split('/').pop() ?? '' });
              totalPages += msg.pages?.length ?? 0;
            }
          } catch { /* skip malformed lines */ }
        }
      }

      showToast(`Generated ${totalPages} page(s) in ${space}`);
      onComplete();
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Processing failed');
      setStage('error');
    }
  };

  const reindex = async () => {
    setStage('reindexing');
    setError('');
    try {
      const res = await fetch('/api/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space }),
      });
      if (!res.ok) throw new Error('Re-index failed');
      showToast(`Re-indexed ${space}`);
      onComplete();
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Re-index failed');
      setStage('error');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
  };

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={handleClose}>
      <div className="upload-panel" onClick={(e) => e.stopPropagation()}>
        <div className="upload-panel-header">
          <h3>Upload &amp; process</h3>
          <button className="btn ghost" onClick={handleClose}>{ICONS.close}</button>
        </div>

        {(stage === 'idle' || stage === 'error') && (
          <>
            <label className="upload-field">
              <span>Space</span>
              <select value={space} onChange={(e) => setSpace(e.target.value)}>
                {spaces.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <div
              className={'upload-dropzone' + (dragOver ? ' dragover' : '')}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <span className="upload-dropzone-icon">{ICONS.plus}</span>
              <p>Drop a .md file here or click to browse</p>
            </div>
            <input ref={inputRef} type="file" accept=".md" hidden onChange={onFileChange} />

            <div className="upload-actions">
              <button className="btn secondary" onClick={() => curate()} disabled={rawCount === 0}>
                {ICONS.spark} Process all{rawCount != null ? ` (${rawCount})` : ''}
              </button>
              <button className="btn secondary" onClick={reindex}>
                {ICONS.recent} Re-index
              </button>
            </div>

            {error && <p className="upload-error">{error}</p>}
          </>
        )}

        {stage === 'uploading' && (
          <div className="upload-status">
            <span className="pulse"></span>
            <p>Uploading {fileName}…</p>
          </div>
        )}

        {stage === 'uploaded' && (
          <div className="upload-status">
            <p>✓ Uploaded <strong>{fileName}</strong> to <code>{space}/raw/</code></p>
            <button className="btn primary" onClick={() => curate(uploadedKey)}>
              {ICONS.spark} Process now
            </button>
          </div>
        )}

        {stage === 'processing' && (
          <div className="upload-status">
            <p>Processing with Bedrock…</p>
            {progress && (
              <>
                <div className="upload-progress-bar">
                  <div className="upload-progress-fill" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                </div>
                <p className="upload-progress-label">{progress.current}/{progress.total} — {progress.file}</p>
              </>
            )}
            {!progress && <span className="pulse"></span>}
          </div>
        )}

        {stage === 'reindexing' && (
          <div className="upload-status">
            <span className="pulse"></span>
            <p>Re-indexing {space}…</p>
          </div>
        )}
      </div>
    </div>
  );
}
