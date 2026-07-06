import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authConfig, authMode, isPrincipalAllowed } from '@/lib/auth';

/**
 * Auth gate config + authorization (plan 029). The load-bearing invariant:
 * `AUTH_MODE` unset ⇒ `none` (today's open portal). The security primitive:
 * the allowlist is deny-by-default (authenticating ≠ being allowed in).
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

  it('falls back to none on an unknown value (mode selector fails open; the allowlist fails closed)', () => {
    process.env.AUTH_MODE = 'oauth2';
    expect(authMode()).toBe('none');
  });
});

describe('authConfig', () => {
  const keys = [
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'AUTH_ALLOWED_SUBJECTS',
    'AUTH_ALLOWED_EMAILS',
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => keys.forEach((k) => (saved[k] = process.env[k])));
  afterEach(() => {
    keys.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    });
  });

  it('reads OIDC config and splits allowlists on commas/whitespace', () => {
    process.env.OIDC_ISSUER = 'https://idp.example.com/realms/vault';
    process.env.OIDC_CLIENT_ID = 'canopy';
    process.env.AUTH_ALLOWED_SUBJECTS = 'sub-1, sub-2  sub-3';
    process.env.AUTH_ALLOWED_EMAILS = 'a@x.com\nb@x.com';
    const cfg = authConfig();
    expect(cfg.issuer).toBe('https://idp.example.com/realms/vault');
    expect(cfg.clientId).toBe('canopy');
    expect(cfg.allowedSubjects).toEqual(['sub-1', 'sub-2', 'sub-3']);
    expect(cfg.allowedEmails).toEqual(['a@x.com', 'b@x.com']);
  });

  it('yields nulls / empty lists when unset', () => {
    keys.forEach((k) => delete process.env[k]);
    const cfg = authConfig();
    expect(cfg.issuer).toBeNull();
    expect(cfg.clientId).toBeNull();
    expect(cfg.allowedSubjects).toEqual([]);
    expect(cfg.allowedEmails).toEqual([]);
  });
});

describe('isPrincipalAllowed (deny-by-default)', () => {
  it('denies everyone when the allowlist is empty (fail closed)', () => {
    expect(
      isPrincipalAllowed(
        { sub: 'anyone', email: 'anyone@corp.com' },
        { allowedSubjects: [], allowedEmails: [] },
      ),
    ).toBe(false);
  });

  it('allows a matching subject', () => {
    const cfg = { allowedSubjects: ['user-123'], allowedEmails: [] };
    expect(isPrincipalAllowed({ sub: 'user-123' }, cfg)).toBe(true);
    expect(isPrincipalAllowed({ sub: 'user-999' }, cfg)).toBe(false);
  });

  it('allows a matching email case-insensitively', () => {
    const cfg = { allowedSubjects: [], allowedEmails: ['Owner@Example.com'] };
    expect(isPrincipalAllowed({ email: 'owner@example.com' }, cfg)).toBe(true);
    expect(isPrincipalAllowed({ email: 'intruder@example.com' }, cfg)).toBe(false);
  });

  it('requires a real claim — empty/whitespace claims never match', () => {
    const cfg = { allowedSubjects: [''], allowedEmails: [''] };
    expect(isPrincipalAllowed({ sub: '', email: '' }, cfg)).toBe(false);
    expect(isPrincipalAllowed({ sub: '   ' }, cfg)).toBe(false);
  });

  it('matches when either subject OR email is on its list', () => {
    const cfg = { allowedSubjects: ['s1'], allowedEmails: ['e@x.com'] };
    expect(isPrincipalAllowed({ sub: 's1', email: 'other@x.com' }, cfg)).toBe(true);
    expect(isPrincipalAllowed({ sub: 'other', email: 'e@x.com' }, cfg)).toBe(true);
  });
});
