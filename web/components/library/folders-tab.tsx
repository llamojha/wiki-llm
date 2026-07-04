'use client';

import type React from 'react';

import { type FolderNode, countFolders } from '@/lib/folder-tree';
import { ICONS } from '@/lib/icons';
import { DEFAULT_USER_ID } from '@/lib/vault-paths';

import type { LibraryState } from './use-library-state';

type FoldersTabProps = {
  lib: LibraryState;
  onClose: () => void;
  s3Location: string;
};

export function FoldersTab({ lib, onClose, s3Location }: FoldersTabProps) {
  const {
    newFolder, setNewFolder, folderBusy, newFolderValid, createFolderReq,
    newFolderClean, scope, scopeLabel, topNodes,
    expanded, editingPath, deletingPath, addingChildPath, editValue, setEditValue,
    childValue, setChildValue, childValid, editInputRef, childInputRef,
    toggleExpand, submitRename, setEditingPath, startAddChild, startRename,
    resetFolderEdits, setDeletingPath, submitDelete, submitAddChild, setAddingChildPath,
  } = lib;

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
  );
}
