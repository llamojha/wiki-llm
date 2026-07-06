export default function HomePage() {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '4rem 2rem' }}>
      {/* Hero */}
      <section style={{ textAlign: 'center', marginBottom: '5rem' }}>
        <svg
          width="64"
          height="64"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ marginBottom: '1.5rem' }}
        >
          <rect width="32" height="32" rx="7" fill="#0f2419" />
          <ellipse cx="16" cy="13" rx="10" ry="7" fill="#166534" />
          <ellipse cx="16" cy="11" rx="8" ry="6" fill="#2d8a4e" />
          <ellipse cx="16" cy="9.5" rx="5.5" ry="4.5" fill="#4ade80" />
          <rect x="15" y="18" width="2" height="7" rx="1" fill="#2d5a3a" />
        </svg>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '0.75rem', letterSpacing: '-0.02em' }}>
          Canopy
        </h1>
        <p style={{ fontSize: '1.25rem', color: 'var(--fg-1)', maxWidth: 600, margin: '0 auto 2rem' }}>
          Your own wiki, powered by LLM, backed by S3.
        </p>
        <p style={{ color: 'var(--fg-2)', maxWidth: 640, margin: '0 auto' }}>
          Markdown in object storage is the durable knowledge layer. Canopy renders,
          searches, and lets a Bedrock-powered agent answer questions grounded in your
          own documents. Self-hosted, your bucket, no lock-in.
        </p>
      </section>

      {/* Features */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '2rem', marginBottom: '5rem' }}>
        <Feature
          title="Browse & Search"
          description="Render and fuzzy-search your Markdown vault from a clean portal UI. Always on, no config needed."
        />
        <Feature
          title="Ask Your Wiki"
          description="A Bedrock Nova agent answers questions with citations grounded in your documents. Every write is user-confirmed."
        />
        <Feature
          title="AI Curation"
          description="Turn raw notes and source documents into structured wiki pages through a Lambda-backed pipeline."
        />
        <Feature
          title="Self-host in Minutes"
          description="One container, point it at an S3 bucket. Deploy with Docker, Kubernetes, ECS Fargate, or Vercel."
        />
      </section>

      {/* Quickstart */}
      <section style={{ marginBottom: '5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>Quickstart</h2>
        <pre>
          <code>{`docker run -d -p 3000:3000 \\
  -e VAULT_BUCKET=my-wiki-bucket \\
  -e VAULT_REGION=us-east-1 \\
  ghcr.io/llamojha/wiki-llm:latest`}</code>
        </pre>
        <p style={{ marginTop: '1rem', color: 'var(--fg-2)' }}>
          Or run locally with <code>pnpm dev</code> — see the{' '}
          <a href="https://github.com/llamojha/wiki-llm#getting-started">Getting Started</a> guide.
        </p>
      </section>

      {/* Links */}
      <section style={{ marginBottom: '4rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>Links</h2>
        <ul style={{ listStyle: 'none', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <li><a href="https://github.com/llamojha/wiki-llm">GitHub</a></li>
          <li><a href="https://github.com/llamojha/wiki-llm/tree/main/docs">Documentation</a></li>
          <li><a href="https://github.com/llamojha/wiki-llm/tree/main/docs/deploy">Deploy Guides</a></li>
        </ul>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--line)', paddingTop: '2rem', color: 'var(--fg-3)', fontSize: '0.875rem' }}>
        <p>MIT License · Canopy is open source.</p>
      </footer>
    </main>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ padding: '1.5rem', background: 'var(--bg-1)', borderRadius: 'var(--r-lg)', border: '1px solid var(--line)' }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{title}</h3>
      <p style={{ color: 'var(--fg-2)', fontSize: '0.9rem' }}>{description}</p>
    </div>
  );
}
