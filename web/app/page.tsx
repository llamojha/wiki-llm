export default function Home() {
  return (
    <main style={{ padding: '64px 32px', maxWidth: 720, margin: '0 auto' }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--fg-3)',
          marginBottom: 8,
        }}
      >
        vaultmark · phase 0
      </div>
      <h1
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: '-0.018em',
          margin: 0,
          color: 'var(--fg)',
        }}
      >
        Scaffold up.
      </h1>
      <p style={{ color: 'var(--fg-2)', fontSize: 14, marginTop: 8 }}>
        Visual port of <code style={{ fontFamily: 'var(--font-mono)' }}>portal/</code> begins in
        Phase 1.
      </p>
    </main>
  );
}
