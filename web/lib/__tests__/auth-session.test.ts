import { describe, expect, it } from 'vitest';

import {
  decryptSession,
  decryptTransaction,
  encryptSession,
  encryptTransaction,
} from '@/lib/auth-session';

/**
 * Session layer (plan 029). The cookie is the only place the principal lives
 * (no server store), so encryption + tamper-rejection is the whole security
 * property.
 */
const SECRET = 'test-session-secret-abcdefghijklmnopqrstuvwxyz-0123';

describe('session cookie', () => {
  it('round-trips claims through encrypt/decrypt', async () => {
    const token = await encryptSession({ sub: 'u1', email: 'a@x.com', name: 'Ann' }, SECRET);
    expect(await decryptSession(token, SECRET)).toEqual({
      sub: 'u1',
      email: 'a@x.com',
      name: 'Ann',
    });
  });

  it('rejects a token sealed with a different secret (wrong key ⇒ null)', async () => {
    const token = await encryptSession({ sub: 'u1', email: null, name: null }, SECRET);
    expect(await decryptSession(token, 'entirely-different-secret-value-9876543210zzz')).toBeNull();
  });

  it('rejects garbage / missing tokens', async () => {
    expect(await decryptSession('not-a-jwt', SECRET)).toBeNull();
    expect(await decryptSession(undefined, SECRET)).toBeNull();
  });
});

describe('auth transaction cookie', () => {
  it('round-trips state/nonce/verifier/returnTo', async () => {
    const tx = { state: 'st', nonce: 'no', codeVerifier: 'cv', returnTo: '/docs/x' };
    const token = await encryptTransaction(tx, SECRET);
    expect(await decryptTransaction(token, SECRET)).toEqual(tx);
  });

  it('returns null when the token is valid but not a transaction (shape guard)', async () => {
    const sessionToken = await encryptSession({ sub: 'u', email: null, name: null }, SECRET);
    expect(await decryptTransaction(sessionToken, SECRET)).toBeNull();
  });
});
