import { NextResponse } from 'next/server';

/**
 * Liveness endpoint (plan 029). Deliberately **unauthenticated** and
 * **minimal**: Docker `HEALTHCHECK`, k8s probes, and ALB health checks must
 * reach it even when `AUTH_MODE=oidc` gates everything else — gating probes
 * would brick every deploy target. It is on the auth gate's exemption list.
 *
 * Returns only `{ ok: true }` — no vault names, no version, no build info, so
 * an anonymous caller learns nothing about the deployment (this is why it is
 * preferred over exempting `/api/vaults`, which leaks vault identity).
 */
export function GET() {
  return NextResponse.json({ ok: true });
}
