// Sample document tree + content for WikiLLM prototype.
// Realistic engineering content, with rendered markdown blocks already as JSX.

const ICONS = {
  folder: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1.5 4.5C1.5 3.67 2.17 3 3 3h2.59c.4 0 .78.16 1.06.44L7.5 4.29c.28.28.66.44 1.06.44H13c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
  doc: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2h6.5L13 5.5V14H3V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M9.5 2v3.5H13" stroke="currentColor" strokeWidth="1.2"/><path d="M5.5 8h5M5.5 10.5h5M5.5 6h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  chev: <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M3 1.5L6 4.5L3 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/><path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  bell: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 6.5a4 4 0 118 0v2.4l1 1.6H3l1-1.6V6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  spark: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l1.5 4L13.5 7l-4 1.5L8 12.5l-1.5-4L2.5 7l4-1.5L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/></svg>,
  sun: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M5.4 10.6l-1 1M12.6 12.6l-1-1M5.4 5.4l-1-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  moon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13 9.5A5.5 5.5 0 116.5 3a4.5 4.5 0 006.5 6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  plus: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  edit: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  share: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.3"/><path d="M5.6 7.2l4.8-2.4M5.6 8.8l4.8 2.4" stroke="currentColor" strokeWidth="1.3"/></svg>,
  copy: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="5" y="2" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M11 11v2.5c0 .55-.45 1-1 1H3.5c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1H5" stroke="currentColor" strokeWidth="1.3"/></svg>,
  more: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/></svg>,
  home: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 7.5L8 2.5l5.5 5v6h-4v-4h-3v4h-4v-6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  star: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.7 4 4.3.4-3.3 3 1 4.3L8 11.5 4.3 13.7l1-4.3-3.3-3 4.3-.4L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  recent: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  user: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2.5 13.5c.7-2.4 2.9-4 5.5-4s4.8 1.6 5.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  lock: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.3"/><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.3"/></svg>,
  globe: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" stroke="currentColor" strokeWidth="1.3"/></svg>,
  arrow: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  send: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2.5 8L13.5 2.5L11 13.5L7.5 9L2.5 8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/></svg>,
  attach: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 7L6.7 11.8a2.4 2.4 0 11-3.4-3.4l5.5-5.5a1.6 1.6 0 012.3 2.3L5.6 10.7a.8.8 0 01-1.1-1.1l4.2-4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  check: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  info: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 7v4M8 4.8v.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  warn: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L15 13.5H1L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 6v4M8 11.8v.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  close: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  settings: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  tag: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 2v6l7 7 6-6-7-7H2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><circle cx="5" cy="5" r=".8" fill="currentColor"/></svg>,
};

// Document tree
const SHARED_TREE = [
  { id: 'platform', type: 'folder', name: 'platform', children: [
    { id: 'platform/runbooks', type: 'folder', name: 'runbooks', children: [
      { id: 'doc-prod-incident', type: 'doc', name: 'prod-incident-response.md', meta: '4.2k' },
      { id: 'doc-postgres-failover', type: 'doc', name: 'postgres-failover.md', meta: '2.1k' },
      { id: 'doc-eks-rotation', type: 'doc', name: 'eks-node-rotation.md', meta: '1.8k' },
    ]},
    { id: 'platform/architecture', type: 'folder', name: 'architecture', children: [
      { id: 'doc-data-pipeline', type: 'doc', name: 'data-pipeline.md', meta: '3.4k' },
      { id: 'doc-auth-overview', type: 'doc', name: 'auth-overview.md', meta: '1.2k' },
    ]},
    { id: 'doc-platform-onboarding', type: 'doc', name: 'onboarding.md', meta: '5.6k' },
  ]},
  { id: 'engineering', type: 'folder', name: 'engineering', children: [
    { id: 'engineering/services', type: 'folder', name: 'services', children: [
      { id: 'doc-billing-svc', type: 'doc', name: 'billing-service.md', meta: '2.8k' },
      { id: 'doc-search-svc', type: 'doc', name: 'search-service.md', meta: '3.1k' },
      { id: 'doc-notifier-svc', type: 'doc', name: 'notifier-service.md', meta: '1.5k' },
    ]},
    { id: 'doc-coding-standards', type: 'doc', name: 'coding-standards.md', meta: '2.2k' },
    { id: 'doc-pr-review', type: 'doc', name: 'pr-review-guide.md', meta: '1.1k' },
  ]},
  { id: 'incidents', type: 'folder', name: 'incidents', children: [
    { id: 'doc-inc-2026-04-19', type: 'doc', name: '2026-04-19-search-outage.md', meta: '3.7k', tag: 'generated' },
    { id: 'doc-inc-2026-03-02', type: 'doc', name: '2026-03-02-billing-degradation.md', meta: '2.4k', tag: 'generated' },
  ]},
];

const PERSONAL_TREE = [
  { id: 'me/notes', type: 'folder', name: 'notes', children: [
    { id: 'doc-me-q2-planning', type: 'doc', name: 'q2-planning.md', meta: '0.8k' },
    { id: 'doc-me-meeting-2026-04-28', type: 'doc', name: '2026-04-28-platform-sync.md', meta: '0.6k' },
    { id: 'doc-me-ideas', type: 'doc', name: 'product-ideas.md', meta: '0.4k' },
  ]},
  { id: 'me/learning', type: 'folder', name: 'learning', children: [
    { id: 'doc-me-rust', type: 'doc', name: 'rust-async-notes.md', meta: '1.2k' },
    { id: 'doc-me-eks', type: 'doc', name: 'eks-cheatsheet.md', meta: '0.9k' },
  ]},
  { id: 'doc-me-scratchpad', type: 'doc', name: 'scratchpad.md', meta: '0.3k' },
];

// Document content (real-feeling engineering markdown, pre-rendered as JSX)
const DOCS = {
  'doc-prod-incident': {
    title: 'Production Incident Response',
    path: 'shared / platform / runbooks / prod-incident-response.md',
    s3: 's3://wikillm/tenants/acme/shared/platform/runbooks/prod-incident-response.md',
    source: 'shared',
    updated: '2026-04-22',
    author: 'platform-bot',
    tags: ['runbook', 'sev1', 'oncall'],
    checksum: 'sha256:9f1c…b3a4',
    body: 'incident',
  },
  'doc-data-pipeline': {
    title: 'Data Pipeline Architecture',
    path: 'shared / platform / architecture / data-pipeline.md',
    s3: 's3://wikillm/tenants/acme/shared/platform/architecture/data-pipeline.md',
    source: 'shared',
    updated: '2026-04-15',
    author: 'h.okafor',
    tags: ['architecture', 'data', 'kafka'],
    checksum: 'sha256:2d44…1e8c',
    body: 'pipeline',
  },
  'doc-billing-svc': {
    title: 'Billing Service',
    path: 'shared / engineering / services / billing-service.md',
    s3: 's3://wikillm/tenants/acme/shared/engineering/services/billing-service.md',
    source: 'shared',
    updated: '2026-04-29',
    author: 'm.chen',
    tags: ['service', 'billing', 'stripe'],
    checksum: 'sha256:7b21…aa90',
    body: 'billing',
  },
  'doc-me-q2-planning': {
    title: 'Q2 Planning Notes',
    path: 'personal / notes / q2-planning.md',
    s3: 's3://wikillm/tenants/acme/users/u-1042/wiki/notes/q2-planning.md',
    source: 'personal',
    updated: '2026-04-30',
    author: 'you',
    tags: ['planning', 'private'],
    checksum: 'sha256:4e02…77ab',
    body: 'planning',
  },
};

// Search corpus (mocked search index rows)
const SEARCH_INDEX = [
  { id: 'doc-prod-incident', title: 'Production Incident Response', path: 'platform / runbooks', source: 'shared', snippet: 'Page the on-call via PagerDuty using service `prod-platform`. Open an incident channel `#inc-YYYY-MM-DD-summary` and post the initial...', updated: '2d', score: 0.94 },
  { id: 'doc-postgres-failover', title: 'Postgres Failover', path: 'platform / runbooks', source: 'shared', snippet: 'Promote the standby in the secondary AZ. Wait for replication lag to drop below 200ms before redirecting writes via PgBouncer...', updated: '1w', score: 0.81 },
  { id: 'doc-eks-rotation', title: 'EKS Node Rotation', path: 'platform / runbooks', source: 'shared', snippet: 'Drain nodes one at a time using `kubectl drain --ignore-daemonsets`. The cluster autoscaler will replace them within ~3 minutes...', updated: '3w', score: 0.62 },
  { id: 'doc-data-pipeline', title: 'Data Pipeline Architecture', path: 'platform / architecture', source: 'shared', snippet: 'External pipeline writes Markdown to S3 → indexer worker reads via SQS notifications → Postgres + OpenSearch are updated...', updated: '2w', score: 0.88 },
  { id: 'doc-auth-overview', title: 'Auth Overview', path: 'platform / architecture', source: 'shared', snippet: 'Keycloak is the OIDC provider. The FastAPI backend validates JWTs using JWKS cached for 15 minutes. Tenant claim maps to...', updated: '5d', score: 0.76 },
  { id: 'doc-billing-svc', title: 'Billing Service', path: 'engineering / services', source: 'shared', snippet: 'Wraps Stripe with idempotent retries. All invocations are logged with a request_id propagated from the API gateway...', updated: '3d', score: 0.71 },
  { id: 'doc-search-svc', title: 'Search Service', path: 'engineering / services', source: 'shared', snippet: 'Backed by OpenSearch. Documents are pulled from Postgres and pushed via the bulk API in 200-doc batches...', updated: '6d', score: 0.69 },
  { id: 'doc-inc-2026-04-19', title: 'Search Outage — 2026-04-19', path: 'incidents', source: 'generated', snippet: 'OpenSearch primary node went read-only after disk reached 85%. Indexer queue grew to 14k. Recovery: expanded EBS, reindexed...', updated: '13d', score: 0.84 },
  { id: 'doc-coding-standards', title: 'Coding Standards', path: 'engineering', source: 'shared', snippet: 'Python: Black + Ruff. TypeScript: Biome. All public functions must have docstrings. Use semantic commit messages...', updated: '1mo', score: 0.41 },
  { id: 'doc-me-q2-planning', title: 'Q2 Planning Notes', path: 'personal / notes', source: 'personal', snippet: 'Top three: (1) finish search reindex job, (2) propose AI-ready chat endpoint, (3) draft RFC for tenant-scoped quotas...', updated: '1d', score: 0.78 },
  { id: 'doc-me-rust', title: 'Rust async notes', path: 'personal / learning', source: 'personal', snippet: 'Tokio task-locals are nice for tracing context. Don\'t hold a Mutex across .await — use tokio::sync::Mutex instead...', updated: '4d', score: 0.55 },
];

window.WIKI_DATA = { ICONS, SHARED_TREE, PERSONAL_TREE, DOCS, SEARCH_INDEX };
