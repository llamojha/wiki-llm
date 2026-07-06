'use client';

import { ICONS } from '@/lib/icons';
import { DEFAULT_USER_ID } from '@/lib/vault-paths';
import type { FeatureFlags } from '@/lib/flags';

import { FoldersTab } from './library/folders-tab';
import { PendingTab } from './library/pending-tab';
import { ReindexTab } from './library/reindex-tab';
import { UploadTab } from './library/upload-tab';
import { type LibraryTab, useLibraryState } from './library/use-library-state';

export type { LibraryTab };

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
  /** Folders mode has a single implicit scope — hides the Shared/My toggle. */
  foldersMode?: boolean;
};

/**
 * Library modal shell. All state, effects, and handlers live in
 * `useLibraryState` (kept mounted while `open`, so every tab's state survives
 * tab switches); the four tab components are pure JSX over that state. The
 * shell owns only the shared chrome: header, scope toggle, tab bar, and the
 * folder selector shared by Upload/Pending/Re-index.
 */
export function UploadModal({ open, initialTab, spaces, onClose, onUploaded, showToast, flags, s3Location, foldersMode }: UploadModalProps) {
  const lib = useLibraryState({ open, initialTab, spaces, flags, onUploaded, onClose, showToast });

  if (!open) return null;

  const {
    tab, setTab, scope, switchScope, batchRunning, scopeIndexed, pendingCount,
    space, setSpace, setFolder, folder, destination, setDestination, spaceList,
    topNodes, subfolderSuggestions, cleanSeg,
  } = lib;

  // Full S3 destination for the current selection — shared by the inline
  // preview here and the upload tab's CLI instructions so they never drift.
  const destPath =
    s3Location +
    (scope === 'user' ? `users/${DEFAULT_USER_ID}/` : '') +
    (destination === 'raw' ? 'raw/' : `authored/${space || '<folder>'}/`) +
    (cleanSeg(folder) ? `${cleanSeg(folder)}/` : '');

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
            folders independently. Hidden in folders mode, which has a single
            implicit scope (no `users/` tree — spec §4). */}
        {!foldersMode && (
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

        {tab === 'upload' && <UploadTab lib={lib} onClose={onClose} destPath={destPath} />}
        {tab === 'pending' && <PendingTab lib={lib} onClose={onClose} />}
        {tab === 'reindex' && <ReindexTab lib={lib} onClose={onClose} />}
        {tab === 'folders' && <FoldersTab lib={lib} onClose={onClose} s3Location={s3Location} />}
      </div>
    </div>
  );
}
