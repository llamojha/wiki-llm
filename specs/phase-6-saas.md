# Phase 6 — SaaS

**Milestone:** SaaS (only after MVP 2 is battle-tested)

## Goal

Transform Vaultmark from a single-user personal tool into a multi-tenant hosted product with authentication, isolation, and operational infrastructure.

## Vision

Teams sign up, connect their S3 buckets, and get isolated wiki portals with per-user access control — managed through an admin dashboard with billing and audit trails.

## Objective

Add multi-tenancy, authentication (Keycloak/OIDC), tenant-isolated storage, scalable search, managed infrastructure (EKS + RDS), and operational tooling.

## Acceptance Criteria

1. Multi-tenant S3 layout (`tenants/<tenant>/users/<user>/`) enforces data isolation between tenants.
2. Authentication via Keycloak/OIDC/SAML; users cannot access vaults they don't own or aren't invited to.
3. Search backend scales beyond Postgres FTS (OpenSearch or Meilisearch) without changing the API contract.
4. Infrastructure runs on EKS with RDS Postgres; deployable via IaC (Terraform or CDK).
5. Admin dashboard exists for tenant management, user provisioning, and usage visibility.
6. Billing integration tracks per-tenant usage (storage, API calls, agent invocations).
7. Audit logs capture all write operations and access events per tenant.
8. Tenant isolation is verified: one tenant cannot read, write, or search another tenant's data.
9. Zero-downtime deployments for the web and API layers.
