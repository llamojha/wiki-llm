// Pre-rendered doc bodies for WikiLLM. Returns JSX given a body key.

function DocBody({ which }) {
  const I = window.WIKI_DATA.ICONS;
  switch (which) {
    case 'incident':
      return <>
        <p>This runbook describes the standard procedure for responding to <strong>SEV-1</strong> and <strong>SEV-2</strong> incidents in production. The goal is to minimize customer impact, communicate clearly, and produce a high-quality post-incident review.</p>

        <h2 id="sec-1">1. Detection &amp; Paging</h2>
        <p>Incidents are detected through one of three channels:</p>
        <ul>
          <li><strong>Datadog monitors</strong> — page the on-call engineer through PagerDuty service <code>prod-platform</code>.</li>
          <li><strong>Customer reports</strong> — Support escalates via <code>#support-escalations</code>.</li>
          <li><strong>Synthetic checks</strong> — Pingdom triggers if <code>app.wikillm.io</code> is unreachable for 90s.</li>
        </ul>

        <div className="callout warn">
          <span className="icon">{I.warn}</span>
          <div><strong>If you're paged at 3 a.m.</strong> — acknowledge within 5 minutes, then take 60 seconds to fully wake up before acting. Most outages are not made worse by a 60-second pause; many are made worse by a half-asleep <code>kubectl delete</code>.</div>
        </div>

        <h2 id="sec-2">2. Initial Response</h2>
        <p>Within the first 10 minutes you should:</p>
        <ol>
          <li>Open an incident channel: <code>#inc-YYYY-MM-DD-short-summary</code>.</li>
          <li>Declare a SEV level using the <code>/incident declare</code> Slack command.</li>
          <li>Assign an <strong>Incident Commander</strong> (IC). If you were paged, you are IC by default until handed off.</li>
          <li>Post the initial situation report — what is broken, blast radius, current hypothesis.</li>
        </ol>

        <h3 id="sec-2-1">2.1 SEV definitions</h3>
        <table>
          <thead><tr><th>Level</th><th>Definition</th><th>Page</th></tr></thead>
          <tbody>
            <tr><td>SEV-1</td><td>Customer-facing outage of a core flow</td><td>Page IC + Eng Mgr</td></tr>
            <tr><td>SEV-2</td><td>Major degradation; partial impact</td><td>Page IC</td></tr>
            <tr><td>SEV-3</td><td>Internal-only or single-tenant impact</td><td>No page; ticket</td></tr>
          </tbody>
        </table>

        <h2 id="sec-3">3. Mitigation</h2>
        <p>Always prefer <em>mitigation</em> over <em>resolution</em>. Roll back deploys before debugging code. Disable a feature flag before patching it.</p>

        <pre><code>{`# Roll back the most recent deploy of a service
kubectl rollout undo deployment/<service> -n prod

# Disable a feature flag globally
launchctl flag disable <flag-key> --scope global

# Drain traffic from a region
aws elbv2 modify-target-group-attributes \\
  --target-group-arn $TG_ARN \\
  --attributes Key=deregistration_delay.timeout_seconds,Value=10`}</code></pre>

        <div className="callout info">
          <span className="icon">{I.info}</span>
          <div>The platform team maintains pre-approved mitigations in <a href="#">runbooks/mitigations.md</a>. If the situation matches one of those, you do <strong>not</strong> need additional approval to execute it.</div>
        </div>

        <h2 id="sec-4">4. Communication</h2>
        <p>The IC owns customer communication via the status page. Aim for an update at least every <strong>30 minutes</strong> during a SEV-1, even if the update is "still investigating." Silence is worse than uncertainty.</p>

        <blockquote>
          <p><strong>Rule of thumb:</strong> if a customer would learn more by refreshing your status page than by reading your last update, you waited too long.</p>
        </blockquote>

        <h2 id="sec-5">5. Post-Incident Review</h2>
        <p>Within <strong>three business days</strong> of resolution, schedule a blameless review. The IC drafts the timeline; the team adds context. The output is a document in <code>incidents/</code> that includes:</p>
        <ul>
          <li>Timeline (UTC, with sources)</li>
          <li>Root cause(s) and contributing factors</li>
          <li>Customer impact (numbers, not adjectives)</li>
          <li>What worked well</li>
          <li>Action items with owners and due dates</li>
        </ul>
        <p>Action items should be filed as Linear tickets <em>before</em> the review meeting ends. Items without owners do not exist.</p>
      </>;

    case 'pipeline':
      return <>
        <p>The data pipeline ingests Markdown from external sources, transforms it, and makes it available to the runtime portal. This document describes the pipeline as of <strong>2026-Q2</strong>.</p>

        <h2 id="sec-1">1. Components</h2>
        <div className="diagram">
          <PipelineDiagram />
        </div>
        <p>Markdown is produced by a number of upstream pipelines (release notes, generated runbooks, architecture docs exported from internal tooling). They all converge on a single S3 bucket as the source of truth.</p>

        <h2 id="sec-2">2. Ingestion contract</h2>
        <p>Producers must write to:</p>
        <pre><code>s3://wikillm/tenants/{'{tenant}'}/shared/{'{path}'}.md</code></pre>
        <p>Each object must include the following S3 metadata headers:</p>
        <ul>
          <li><code>x-wikillm-source</code> — pipeline name (e.g. <code>release-notes</code>)</li>
          <li><code>x-wikillm-author</code> — service principal or user</li>
          <li><code>x-wikillm-tags</code> — comma-separated list, optional</li>
        </ul>

        <div className="callout info">
          <span className="icon">{I.info}</span>
          <div>S3 PUTs trigger an SQS notification to <code>wikillm-indexer</code>. The indexer is idempotent — duplicate notifications are safe.</div>
        </div>

        <h2 id="sec-3">3. Indexing</h2>
        <p>The indexer worker performs the following on each event:</p>
        <ol>
          <li>Fetch the object and verify the SHA-256 checksum.</li>
          <li>Parse frontmatter and extract <code>title</code>, <code>tags</code>, <code>visibility</code>.</li>
          <li>Tokenize the body and update the OpenSearch index.</li>
          <li>Upsert document metadata into Postgres.</li>
          <li>Invalidate any cached HTML keyed by the old checksum.</li>
        </ol>

        <h3 id="sec-3-1">3.1 Reindexing</h3>
        <p>A full reindex can be triggered with:</p>
        <pre><code>{`wikillmctl reindex --tenant=<tenant> [--prefix=<s3-prefix>]`}</code></pre>

        <h2 id="sec-4">4. Failure modes</h2>
        <table>
          <thead><tr><th>Failure</th><th>Detection</th><th>Mitigation</th></tr></thead>
          <tbody>
            <tr><td>SQS DLQ growing</td><td>Datadog monitor</td><td>Drain via <code>wikillmctl drain-dlq</code></td></tr>
            <tr><td>OpenSearch lag</td><td>Custom metric <code>indexer.lag_s</code></td><td>Scale workers (<code>kubectl scale</code>)</td></tr>
            <tr><td>S3 5xx burst</td><td>AWS Health Dashboard</td><td>Indexer retries with backoff; no action</td></tr>
          </tbody>
        </table>
      </>;

    case 'billing':
      return <>
        <p>The billing service is responsible for plan changes, invoicing, and metered usage reporting. It wraps Stripe and exposes a tenant-scoped API.</p>

        <h2 id="sec-1">1. Responsibilities</h2>
        <ul>
          <li>Plan management — Free, Team, Enterprise.</li>
          <li>Seat-based and usage-based billing.</li>
          <li>Invoice generation and webhook handling.</li>
          <li>Dunning and retry logic for failed charges.</li>
        </ul>

        <h2 id="sec-2">2. Idempotency</h2>
        <p>All write endpoints accept an <code>Idempotency-Key</code> header and forward it to Stripe. Internal callers should generate a UUIDv7 keyed on <code>(tenant_id, action, request_id)</code>.</p>

        <pre><code>{`POST /v1/billing/charges
Idempotency-Key: 0190a3f9-3c5b-7d2e-9b1c-...
Content-Type: application/json

{
  "tenant_id": "t_acme",
  "amount_cents": 9900,
  "currency": "usd",
  "description": "Team plan, May 2026"
}`}</code></pre>

        <h2 id="sec-3">3. Webhooks</h2>
        <p>Stripe webhooks are received at <code>/v1/billing/webhooks/stripe</code> and verified using the signing secret in <code>secrets/stripe-webhook-secret</code>. Events are persisted to <code>billing.webhook_events</code> before processing — even if downstream handling fails, the event is preserved for replay.</p>

        <div className="callout danger">
          <span className="icon">{I.warn}</span>
          <div><strong>Never</strong> log the raw webhook body — it can contain card brand and last-4 metadata that is out of scope for our PCI environment.</div>
        </div>

        <h2 id="sec-4">4. Usage metering</h2>
        <p>Usage events flow in over Kafka (<code>topic: billing.usage.v1</code>) and are aggregated hourly into <code>billing.usage_buckets</code>. The aggregator can be re-run for any window using <code>wikillmctl billing rebuild-buckets</code>.</p>
      </>;

    case 'planning':
      return <>
        <p>Rough notes from the platform Q2 planning session, 2026-04-28. Not yet shared.</p>

        <h2 id="sec-1">Top three for the quarter</h2>
        <ol>
          <li>Finish the search reindex job — it's the last blocker for OpenSearch 2.x upgrade.</li>
          <li>Propose AI-ready chat endpoint with permission-filtered context. Need an RFC by EOM.</li>
          <li>Draft the tenant-scoped quota model. We've been losing money on a few outlier tenants.</li>
        </ol>

        <h2 id="sec-2">Things to push back on</h2>
        <ul>
          <li>Vector search in MVP 1 — <strong>not happening</strong>. Keyword + filters is fine for now.</li>
          <li>PDF ingestion. Marketing wants it. Engineering shouldn't pick it up until at least Q3.</li>
        </ul>

        <h2 id="sec-3">Open questions</h2>
        <ul>
          <li>Do we want per-document checksums in the cache key, or per-tenant generations?</li>
          <li>Who owns the on-call rotation for the indexer? It's been informally me + h.okafor.</li>
        </ul>

        <div className="callout info">
          <span className="icon">{I.info}</span>
          <div>This page is private. Only you can see it. Move it to <code>shared/</code> if you'd like to share with the team.</div>
        </div>
      </>;

    default:
      return <p>This document hasn't been written yet.</p>;
  }
}

function PipelineDiagram() {
  const nodes = [
    { x: 30, label: 'Pipelines', sub: 'release-notes, runbooks, etc' },
    { x: 220, label: 'S3', sub: 'wikillm/tenants/...' },
    { x: 380, label: 'Indexer', sub: 'SQS-driven worker' },
    { x: 540, label: 'Postgres', sub: 'metadata + perms' },
    { x: 700, label: 'OpenSearch', sub: 'full-text index' },
  ];
  return (
    <svg viewBox="0 0 820 100" width="100%" style={{ maxWidth: 760 }}>
      {nodes.map((n, i) => (
        <g key={i}>
          <rect x={n.x} y={20} width={110} height={48} rx={6}
                fill="var(--panel)" stroke="var(--line-2)" strokeWidth={1}/>
          <text x={n.x + 55} y={42} textAnchor="middle"
                fontSize="12" fontFamily="var(--font-mono)" fontWeight={600}
                fill="var(--fg)">{n.label}</text>
          <text x={n.x + 55} y={58} textAnchor="middle"
                fontSize="9.5" fontFamily="var(--font-mono)"
                fill="var(--fg-2)">{n.sub}</text>
          {i < nodes.length - 1 && (
            <g>
              <line x1={n.x + 110} y1={44} x2={nodes[i+1].x} y2={44}
                    stroke="var(--line-2)" strokeWidth={1}/>
              <polygon points={`${nodes[i+1].x},44 ${nodes[i+1].x - 5},41 ${nodes[i+1].x - 5},47`}
                       fill="var(--line-2)"/>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

window.DocBody = DocBody;
