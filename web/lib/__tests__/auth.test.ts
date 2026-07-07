import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authConfig, authMode } from '@/lib/auth';

/**
 * Auth gate config (plan 029). The load-bearing invariant:
 * `AUTH_MODE` unset ⇒ `none` (today's open portal). Access control is
 * delegated to the identity provider — no application-level allowlist.
 */
describe('authMode', () => {
  const original = process.env.AUTH_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = original;
  });

  it('defaults to none when unset (load-bearing — e2e safe)', () => {
    delete process.env.AUTH_MODE;
    expect(authMode()).toBe('none');
  });

  it('parses the three valid modes case-insensitively', () => {
    process.env.AUTH_MODE = 'oidc';
    expect(authMode()).toBe('oidc');
    process.env.AUTH_MODE = 'PROXY';
    expect(authMode()).toBe('proxy');
    process.env.AUTH_MODE = ' None ';
    expect(authMode()).toBe('none');
  });

  it('falls back to none on an unknown value', () => {
    process.env.AUTH_MODE = 'oauth2';
    expect(authMode()).toBe('none');
  });
});

describe('authConfig', () => {
  const keys = ['OIDC_ISSUER', 'OIDC_CLIENT_ID'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => keys.forEach((k) => (saved[k] = process.env[k])));
  afterEach(() => {
    keys.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    });
  });

  it('reads OIDC config from env', () => {
    process.env.OIDC_ISSUER = 'https://idp.example.com/realms/vault';
    process.env.OIDC_CLIENT_ID = 'canopy';
    const cfg = authConfig();
    expect(cfg.issuer).toBe('https://idp.example.com/realms/vault');
    expect(cfg.clientId).toBe('canopy');
  });

  it('yields nulls when unset', () => {
    keys.forEach((k) => delete process.env[k]);
    const cfg = authConfig();
    expect(cfg.issuer).toBeNull();
    expect(cfg.clientId).toBeNull();
  });
});
