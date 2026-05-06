'use client';

import { useState } from 'react';
import { type ApiTreeNode } from '@/lib/api';
import { ICONS } from '@/lib/icons';
import { type Scope } from '@/lib/types';
import { TreeNode } from './tree-node';

type SidebarProps = {
  scope: Scope;
  setScope: (s: Scope) => void;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNewPage: () => void;
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

function apiTreeToMock(nodes: ApiTreeNode[]): import('@/lib/mock/data').TreeNode[] {
  return nodes.map((n) => {
    if (n.type === 'folder') {
      return { id: n.id, type: 'folder' as const, name: n.name, children: apiTreeToMock(n.children) };
    }
    return { id: n.id, type: 'doc' as const, name: n.name };
  });
}

export function Sidebar({ scope, setScope, activeId, onOpen, onNewPage, apiTree }: SidebarProps) {
  const tree = apiTree && apiTree.length > 0 ? apiTreeToMock(apiTree) : [];
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
        <button className={scope === 'personal' ? 'on' : ''} onClick={() => setScope('personal')}>
          {ICONS.lock} My wiki
        </button>
      </div>

      <button className={'nav-row' + (activeId === '__home' ? ' active' : '')} onClick={() => onOpen('__home')}>
        <span className="nav-icon">{ICONS.home}</span>
        <span className="nav-label">Home</span>
      </button>
      <button className="nav-row" onClick={() => onOpen('__recent')}>
        <span className="nav-icon">{ICONS.recent}</span>
        <span className="nav-label">Recent</span>
      </button>
      <button className="nav-row" onClick={() => onOpen('__starred')}>
        <span className="nav-icon">{ICONS.star}</span>
        <span className="nav-label">Starred</span>
        <span className="nav-meta">7</span>
      </button>

      <div className="nav-section">
        <span>{scope === 'shared' ? 'Shared spaces' : 'My pages'}</span>
        <button onClick={onNewPage} title="New page">{ICONS.plus}</button>
      </div>

      {tree.map((n) => (
        <TreeNode key={n.id} node={n} depth={0}
                  activeId={activeId} onOpen={onOpen}
                  openFolders={openFolders} toggleFolder={toggleFolder}/>
      ))}

      <div className="indexing-status">
        <span className="pulse"></span>
        <div style={{ flex: 1, lineHeight: 1.3 }}>
          <div style={{ color: 'var(--fg-1)', fontWeight: 500 }}>Indexer healthy</div>
          <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>1,284 docs · synced 12s ago</div>
        </div>
      </div>
    </aside>
  );
}
