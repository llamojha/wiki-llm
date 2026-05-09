import { ICONS } from '@/lib/icons';
import type { TreeNode as TreeNodeData } from '@/lib/types';

type TreeNodeProps = {
  node: TreeNodeData;
  depth: number;
  activeId: string | null;
  onOpen: (id: string) => void;
  openFolders: Set<string>;
  toggleFolder: (id: string) => void;
};

export function TreeNode({ node, depth, activeId, onOpen, openFolders, toggleFolder }: TreeNodeProps) {
  if (node.type === 'folder') {
    const isOpen = openFolders.has(node.id);
    return (
      <div className="tree-row">
        <button className="nav-row" onClick={() => toggleFolder(node.id)} style={{ paddingLeft: 6 }}>
          <span className={'tree-toggle' + (isOpen ? ' open' : '')}>
            {ICONS.chev}
          </span>
          <span className="nav-icon">{ICONS.folder}</span>
          <span className="nav-label">{node.name}</span>
        </button>
        {isOpen && (
          <div className="tree-children">
            {node.children.map((c) => (
              <TreeNode key={c.id} node={c} depth={depth + 1}
                        activeId={activeId} onOpen={onOpen}
                        openFolders={openFolders} toggleFolder={toggleFolder}/>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <button className={'nav-row' + (activeId === node.id ? ' active' : '')}
            onClick={() => onOpen(node.id)}
            style={{ paddingLeft: 22 }}>
      <span className="nav-icon">{ICONS.doc}</span>
      <span className="nav-label">{node.name}</span>
      {node.tag === 'generated' && <span className="nav-meta" title="auto-generated">AI</span>}
    </button>
  );
}
