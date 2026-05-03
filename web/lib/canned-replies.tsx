import type { ReactNode } from 'react';
import type { Cite } from '@/lib/mock/data';

export const SUGGESTIONS = [
  "What's the on-call paging procedure?",
  'How does the indexer handle S3 events?',
  'Where do I file a postmortem?',
  'Summarize the billing service',
];

export type CannedReply = {
  match: RegExp;
  text: ReactNode;
  cites: Cite[];
};

export const CANNED_REPLIES: CannedReply[] = [
  {
    match: /(page|on.?call|incident|sev)/i,
    text: <>
      <p>For SEV-1 and SEV-2 incidents, the on-call engineer is paged through PagerDuty service <code>prod-platform</code>. After acknowledging within 5 minutes, you should:</p>
      <p>1. Open <code>#inc-YYYY-MM-DD-summary</code> and declare the SEV with <code>/incident declare</code>.<br/>2. Take the IC role until you hand it off explicitly.<br/>3. Post a status-page update at least every 30 minutes during a SEV-1.</p>
      <p>Always prefer mitigation over resolution — roll back deploys before debugging code.</p>
    </>,
    cites: [
      { id: 'doc-prod-incident', title: 'Production Incident Response', section: '§1 Detection & Paging' },
      { id: 'doc-prod-incident', title: 'Production Incident Response', section: '§3 Mitigation' },
    ],
  },
  {
    match: /(index|s3|pipeline|reindex|sqs)/i,
    text: <>
      <p>Producers write Markdown to <code>s3://wikillm/tenants/&lt;tenant&gt;/shared/&lt;path&gt;.md</code> with three required metadata headers (<code>x-wikillm-source</code>, <code>x-wikillm-author</code>, <code>x-wikillm-tags</code>).</p>
      <p>S3 PUTs trigger an SQS notification to the <code>wikillm-indexer</code> worker, which is idempotent. The worker fetches the object, verifies the SHA-256 checksum, parses frontmatter, tokenizes the body into OpenSearch, and upserts metadata into Postgres. Cached HTML keyed by the old checksum is invalidated.</p>
      <p>To force a full reindex, run <code>wikillmctl reindex --tenant=&lt;tenant&gt;</code>.</p>
    </>,
    cites: [
      { id: 'doc-data-pipeline', title: 'Data Pipeline Architecture', section: '§2 Ingestion contract' },
      { id: 'doc-data-pipeline', title: 'Data Pipeline Architecture', section: '§3 Indexing' },
    ],
  },
  {
    match: /(billing|stripe|invoice|charge)/i,
    text: <>
      <p>The billing service wraps Stripe and exposes a tenant-scoped API for plan changes, invoicing, and metered usage.</p>
      <p>All write endpoints require an <code>Idempotency-Key</code> header — the convention is a UUIDv7 keyed on <code>(tenant_id, action, request_id)</code>. Stripe webhooks land at <code>/v1/billing/webhooks/stripe</code> and are persisted to <code>billing.webhook_events</code> before processing so they can be replayed on failure.</p>
    </>,
    cites: [
      { id: 'doc-billing-svc', title: 'Billing Service', section: '§2 Idempotency' },
      { id: 'doc-billing-svc', title: 'Billing Service', section: '§3 Webhooks' },
    ],
  },
  {
    match: /(postmortem|review|incident review)/i,
    text: <>
      <p>Schedule a blameless review within three business days of resolution. The IC drafts the timeline; the team adds context. The output is a doc in <code>incidents/</code> with timeline, root causes, customer impact (in numbers), what worked, and action items with owners and due dates.</p>
      <p>Action items must be filed as Linear tickets <em>before</em> the review meeting ends — items without owners do not exist.</p>
    </>,
    cites: [
      { id: 'doc-prod-incident', title: 'Production Incident Response', section: '§5 Post-Incident Review' },
    ],
  },
];

export const DEFAULT_REPLY: { text: ReactNode; cites: Cite[] } = {
  text: <>
    <p>I searched the indexed content but couldn't find a confident answer. Try rephrasing or use the search palette (<code>⌘K</code>) for keyword matches.</p>
    <p>Tip: I only see documents you have permission to read. If you expect a result and don't see it, check that the doc is in a space your group can access.</p>
  </>,
  cites: [],
};
