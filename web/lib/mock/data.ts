export type Scope = 'shared' | 'personal';

export type SourceType = 'shared' | 'personal' | 'generated';

export type BodyKey = 'incident' | 'pipeline' | 'billing' | 'planning';

export type DocLeaf = {
  id: string;
  type: 'doc';
  name: string;
  meta?: string;
  tag?: 'generated';
};

export type FolderNode = {
  id: string;
  type: 'folder';
  name: string;
  children: TreeNode[];
};

export type TreeNode = DocLeaf | FolderNode;

import type { ReactNode } from 'react';

export type Cite = {
  id?: string;
  title: string;
  section: string;
};

export type AuthoredDoc = {
  title: string;
  path: string;
  s3: string;
  source: SourceType;
  updated: string;
  author: string;
  tags: string[];
  checksum: string;
  body: BodyKey;
  generated?: false;
};

export type GeneratedDoc = {
  title: string;
  path: string;
  s3: string;
  source: SourceType;
  updated: string;
  author: string;
  tags: string[];
  checksum: string;
  generated: true;
  question: string;
  answer: ReactNode;
  cites: Cite[];
};

export type Doc = AuthoredDoc | GeneratedDoc;

export type SearchHit = {
  id: string;
  title: string;
  path: string;
  source: SourceType;
  snippet: string;
  updated: string;
  score: number;
};

export const SHARED_TREE: TreeNode[] = [
  {
    id: 'platform',
    type: 'folder',
    name: 'platform',
    children: [
      {
        id: 'platform/runbooks',
        type: 'folder',
        name: 'runbooks',
        children: [
          { id: 'doc-prod-incident', type: 'doc', name: 'prod-incident-response.md', meta: '4.2k' },
          { id: 'doc-postgres-failover', type: 'doc', name: 'postgres-failover.md', meta: '2.1k' },
          { id: 'doc-eks-rotation', type: 'doc', name: 'eks-node-rotation.md', meta: '1.8k' },
        ],
      },
      {
        id: 'platform/architecture',
        type: 'folder',
        name: 'architecture',
        children: [
          { id: 'doc-data-pipeline', type: 'doc', name: 'data-pipeline.md', meta: '3.4k' },
          { id: 'doc-auth-overview', type: 'doc', name: 'auth-overview.md', meta: '1.2k' },
        ],
      },
      { id: 'doc-platform-onboarding', type: 'doc', name: 'onboarding.md', meta: '5.6k' },
    ],
  },
  {
    id: 'engineering',
    type: 'folder',
    name: 'engineering',
    children: [
      {
        id: 'engineering/services',
        type: 'folder',
        name: 'services',
        children: [
          { id: 'doc-billing-svc', type: 'doc', name: 'billing-service.md', meta: '2.8k' },
          { id: 'doc-search-svc', type: 'doc', name: 'search-service.md', meta: '3.1k' },
          { id: 'doc-notifier-svc', type: 'doc', name: 'notifier-service.md', meta: '1.5k' },
        ],
      },
      { id: 'doc-coding-standards', type: 'doc', name: 'coding-standards.md', meta: '2.2k' },
      { id: 'doc-pr-review', type: 'doc', name: 'pr-review-guide.md', meta: '1.1k' },
    ],
  },
  {
    id: 'incidents',
    type: 'folder',
    name: 'incidents',
    children: [
      { id: 'doc-inc-2026-04-19', type: 'doc', name: '2026-04-19-search-outage.md', meta: '3.7k', tag: 'generated' },
      { id: 'doc-inc-2026-03-02', type: 'doc', name: '2026-03-02-billing-degradation.md', meta: '2.4k', tag: 'generated' },
    ],
  },
];

export const PERSONAL_TREE: TreeNode[] = [
  {
    id: 'me/notes',
    type: 'folder',
    name: 'notes',
    children: [
      { id: 'doc-me-q2-planning', type: 'doc', name: 'q2-planning.md', meta: '0.8k' },
      { id: 'doc-me-meeting-2026-04-28', type: 'doc', name: '2026-04-28-platform-sync.md', meta: '0.6k' },
      { id: 'doc-me-ideas', type: 'doc', name: 'product-ideas.md', meta: '0.4k' },
    ],
  },
  {
    id: 'me/learning',
    type: 'folder',
    name: 'learning',
    children: [
      { id: 'doc-me-rust', type: 'doc', name: 'rust-async-notes.md', meta: '1.2k' },
      { id: 'doc-me-eks', type: 'doc', name: 'eks-cheatsheet.md', meta: '0.9k' },
    ],
  },
  { id: 'doc-me-scratchpad', type: 'doc', name: 'scratchpad.md', meta: '0.3k' },
];

export const DOCS: Record<string, Doc> = {
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

export const SEARCH_INDEX: SearchHit[] = [
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
