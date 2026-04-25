import { ICONS, type IconKey } from '@/lib/icons';
import { DOCS, PERSONAL_TREE, SEARCH_INDEX, SHARED_TREE, type TreeNode } from '@/lib/mock/data';

export const dynamic = 'force-static';

function countTree(nodes: TreeNode[]): { folders: number; docs: number } {
  let folders = 0;
  let docs = 0;
  for (const n of nodes) {
    if (n.type === 'folder') {
      folders += 1;
      const sub = countTree(n.children);
      folders += sub.folders;
      docs += sub.docs;
    } else {
      docs += 1;
    }
  }
  return { folders, docs };
}

export default function ParityPage() {
  if (process.env.NODE_ENV === 'production') {
    return <main style={{ padding: 32 }}>Not available in production builds.</main>;
  }

  const iconKeys = Object.keys(ICONS) as IconKey[];
  const sharedCounts = countTree(SHARED_TREE);
  const personalCounts = countTree(PERSONAL_TREE);

  return (
    <main style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto', color: 'var(--fg)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>
        vaultmark · phase 1 step 1
      </div>
      <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.018em', margin: 0 }}>
        Parity check — foundation
      </h1>
      <p style={{ color: 'var(--fg-2)', fontSize: 14, marginTop: 6 }}>
        Open <code style={{ fontFamily: 'var(--font-mono)' }}>portal/index.html</code> in another tab and visually
        compare every icon below against the prototype. Run{' '}
        <code style={{ fontFamily: 'var(--font-mono)' }}>node scripts/parity-step1.mjs</code> from the repo root for
        structural counts.
      </p>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>Counts</h2>
        <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: 'var(--fg-2)' }}>
              <th style={{ textAlign: 'left', padding: '6px 18px 6px 0', borderBottom: '1px solid var(--line)' }}>Surface</th>
              <th style={{ textAlign: 'right', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>Count</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={{ padding: '6px 18px 6px 0' }}>icons</td><td style={{ textAlign: 'right' }}>{iconKeys.length}</td></tr>
            <tr><td style={{ padding: '6px 18px 6px 0' }}>SHARED_TREE folders</td><td style={{ textAlign: 'right' }}>{sharedCounts.folders}</td></tr>
            <tr><td style={{ padding: '6px 18px 6px 0' }}>SHARED_TREE docs</td><td style={{ textAlign: 'right' }}>{sharedCounts.docs}</td></tr>
            <tr><td style={{ padding: '6px 18px 6px 0' }}>PERSONAL_TREE folders</td><td style={{ textAlign: 'right' }}>{personalCounts.folders}</td></tr>
            <tr><td style={{ padding: '6px 18px 6px 0' }}>PERSONAL_TREE docs</td><td style={{ textAlign: 'right' }}>{personalCounts.docs}</td></tr>
            <tr><td style={{ padding: '6px 18px 6px 0' }}>DOCS entries</td><td style={{ textAlign: 'right' }}>{Object.keys(DOCS).length}</td></tr>
            <tr><td style={{ padding: '6px 18px 6px 0' }}>SEARCH_INDEX rows</td><td style={{ textAlign: 'right' }}>{SEARCH_INDEX.length}</td></tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 36 }}>
        <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>Icons</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 8,
          }}
        >
          {iconKeys.map((k) => (
            <div
              key={k}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 7,
                background: 'var(--panel)',
                color: 'var(--fg-1)',
              }}
            >
              <span style={{ display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                {ICONS[k]}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg-2)' }}>{k}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
