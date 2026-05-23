'use client';

import { useState } from 'react';
import { type ApiTreeNode } from '@/lib/api';
import { ICONS } from '@/lib/icons';
import { type Scope, type TreeNode as TreeNodeType } from '@/lib/types';
import { TreeNode } from './tree-node';

type SidebarProps = {
  scope: Scope;
  setScope: (s: Scope) => void;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNewPage: () => void;
  onUpload: () => void;
  onProcessPending: () => void;
  onReindex: () => void;
  apiTree?: ApiTreeNode[];
};

const DEFAULT_OPEN_FOLDERS = new Set([
  'platform',
  'platform/runbooks',
  'engineering',
  'engineering/services',
  'me/notes',
  'me/learning',
]);

function apiTreeToLocal(nodes: ApiTreeNode[]): TreeNodeType[] {
  return nodes.map((n) => {
    if (n.type === 'folder') {
      return { id: n.id, type: 'folder' as const, name: n.name, children: apiTreeToLocal(n.children) };
    }
    return { id: n.id, type: 'doc' as const, name: n.name };
  });
}

function countDocs(nodes: TreeNodeType[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'doc') count++;
    else if (n.type === 'folder') count += countDocs(n.children);
  }
  return count;
}

function filterByScope(nodes: TreeNodeType[], scope: Scope): TreeNodeType[] {
  if (scope === 'user') {
    const user = nodes.find(
      (n): n is TreeNodeType & { type: 'folder' } =>
        n.type === 'folder' && n.id === 'folder:__user',
    );
    return user?.children ?? [];
  }
  return nodes.filter((n) => !(n.type === 'folder' && n.id === 'folder:__user'));
}

export function Sidebar({ scope, setScope, activeId, onOpen, onNewPage, onUpload, onProcessPending, onReindex, apiTree }: SidebarProps) {
  const fullTree = apiTree && apiTree.length > 0 ? apiTreeToLocal(apiTree) : [];
  const tree = filterByScope(fullTree, scope);
  const [openFolders, setOpenFolders] = useState<Set<string>>(DEFAULT_OPEN_FOLDERS);
  const toggleFolder = (id: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <aside className="sidebar">
      <div className="scope-switch">
        <button className={scope === 'shared' ? 'on' : ''} onClick={() => setScope('shared')}>
          {ICONS.globe} Shared
        </button>
        <button className={scope === 'user' ? 'on' : ''} onClick={() => setScope('user')}>
          {ICONS.lock} My wiki
        </button>
      </div>

      <button className={'nav-row' + (activeId === '__home' ? ' active' : '')} onClick={() => onOpen('__home')}>
        <span className="nav-icon">{ICONS.home}</span>
        <span className="nav-label">Home</span>
      </button>
      <button className={'nav-row' + (activeId === '__recent' ? ' active' : '')} onClick={() => onOpen('__recent')}>
        <span className="nav-icon">{ICONS.recent}</span>
        <span className="nav-label">Recent</span>
      </button>
      <button className={'nav-row' + (activeId === '__starred' ? ' active' : '')} onClick={() => onOpen('__starred')}>
        <span className="nav-icon">{ICONS.star}</span>
        <span className="nav-label">Starred</span>
      </button>

      <div className="nav-section">
        <span>{scope === 'shared' ? 'Shared spaces' : 'My library'}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={onUpload} title="Upload Markdown files">{ICONS.upload}</button>
          <button onClick={onNewPage} title="New page">{ICONS.plus}</button>
        </div>
      </div>

      {tree.map((n) => (
        <TreeNode key={n.id} node={n} depth={0}
                  activeId={activeId} onOpen={onOpen}
                  openFolders={openFolders} toggleFolder={toggleFolder}/>
      ))}

      <div className="index-card">
        <div className="index-card-row">
          <span className="pulse"></span>
          <div style={{ flex: 1, lineHeight: 1.3 }}>
            <div style={{ color: 'var(--fg-1)', fontWeight: 500 }}>Indexer healthy</div>
            <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>
              {countDocs(fullTree)} indexed
            </div>
          </div>
        </div>
        <div className="index-card-actions">
          <button className="index-card-btn" onClick={onProcessPending} title="Curate raw files in S3">
            {ICONS.spark} Process pending
          </button>
          <button className="index-card-btn" onClick={onReindex} title="Re-index everything">
            {ICONS.recent} Re-index
          </button>
        </div>
      </div>
    </aside>
  );
}
