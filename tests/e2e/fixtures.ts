/**
 * Fixture vault for Playwright e2e tests.
 *
 * Returns a key→content map that is POSTed to `/api/__test__/seed` to populate
 * the in-memory mock S3 store before each test. Keys are relative (no
 * VAULT_PREFIX) — the same format the API routes use throughout.
 *
 * The vault layout mirrors a real Vaultmark deployment:
 *   - `_system/structure.json` — declares the `wiki` shared space + the
 *     default user. Required by `getStructure()` for tree/reindex.
 *   - `_system/index.md` / `_system/indexes/wiki.md` — catalogs read by the
 *     agent and reindex flows.
 *   - `_system/log.md` — append-target for create/edit/delete.
 *   - shared docs under `authored/wiki/`.
 *   - generated doc under `generated/wiki/`.
 *   - personal docs under `users/default/authored/personal/`.
 */

export type Seed = Record<string, string>;

const STRUCTURE = {
  version: 2,
  roots: {
    raw: 'raw/',
    generated: 'generated/',
    authored: 'authored/',
    users: 'users/',
    system: '_system/',
  },
  defaultUser: 'default',
  users: [
    {
      id: 'default',
      label: 'My wiki',
      default: true,
      prefix: 'users/default/',
      root: 'users/default/',
      roots: {
        raw: 'users/default/raw/',
        generated: 'users/default/generated/',
        authored: 'users/default/authored/',
        system: 'users/default/_system/',
      },
    },
  ],
  spaces: [
    { name: 'wiki', label: 'Wiki', indexed: true, generated: true, authored: true },
    { name: 'personal', label: 'Personal', indexed: false },
  ],
  ingest: {
    space: 'wiki',
    rawPrefix: 'raw/',
  },
};

const onboardingMd = `---
title: Onboarding Guide
source_type: authored
author: docs-team
updated: 2026-05-01T10:00:00Z
tags: [onboarding, intro]
---

# Onboarding Guide

Welcome to **Vaultmark**. This guide covers the first-week checklist for new
engineers.

## Day 1
- Pick up your laptop
- Set up SSO
- Read the on-call runbook
`;

const oncallMd = `---
title: On-Call Runbook
source_type: authored
author: sre-team
updated: 2026-05-02T09:00:00Z
tags: [oncall, sre, incident]
---

# On-Call Runbook

Primary procedures for the paging on-call rotation. Cover incidents,
escalation, and post-mortems.

## Paging

The pager fires when PagerDuty matches a critical alert. Acknowledge within
five minutes.
`;

const billingMd = `---
title: Billing Service
source_type: generated
author: agent
updated: 2026-05-03T14:30:00Z
tags: [billing, service]
---

# Billing Service

Synthesized overview of the **Billing** microservice. Handles invoice
generation and subscription state.
`;

const personalNoteMd = `---
title: Q2 Planning
source_type: personal
author: you
updated: 2026-05-10T11:00:00Z
tags: [planning, q2]
starred: true
---

# Q2 Planning

Personal scratchpad for Q2 OKRs.
`;

const personalIdeasMd = `---
title: Ideas
source_type: personal
author: you
updated: 2026-05-12T08:00:00Z
tags: [ideas]
---

# Ideas

Half-baked thoughts to revisit later.
`;

const indexMd = `---
title: Index
type: nav
updated: 2026-05-12T00:00:00Z
---

## Wiki
- authored/wiki/onboarding.md — Onboarding Guide — first-week checklist
- authored/wiki/on-call.md — On-Call Runbook — paging procedures
- generated/wiki/billing-service.md — Billing Service — invoice and subscription handling
`;

const wikiIndexMd = `---
title: Wiki Index
type: nav
updated: 2026-05-12T00:00:00Z
---

- authored/wiki/onboarding.md — Onboarding Guide — first-week checklist
- authored/wiki/on-call.md — On-Call Runbook — paging procedures
- generated/wiki/billing-service.md — Billing Service — invoice and subscription handling
`;

const logMd = `---
title: Activity Log
type: log
---

- 2026-05-01T10:00:00Z created authored/wiki/onboarding.md "Onboarding Guide"
- 2026-05-02T09:00:00Z created authored/wiki/on-call.md "On-Call Runbook"
- 2026-05-03T14:30:00Z created generated/wiki/billing-service.md "Billing Service"
`;

export function defaultSeed(): Seed {
  return {
    '_system/structure.json': JSON.stringify(STRUCTURE, null, 2),
    '_system/index.md': indexMd,
    '_system/indexes/wiki.md': wikiIndexMd,
    '_system/log.md': logMd,

    'authored/wiki/onboarding.md': onboardingMd,
    'authored/wiki/on-call.md': oncallMd,
    'generated/wiki/billing-service.md': billingMd,

    'users/default/authored/personal/q2-planning.md': personalNoteMd,
    'users/default/authored/personal/ideas.md': personalIdeasMd,

    'users/default/_system/structure.json': JSON.stringify(STRUCTURE, null, 2),
  };
}
