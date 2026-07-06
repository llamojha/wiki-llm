import { describe, expect, it } from 'vitest';

import { deriveLogoutUrl } from '@/lib/auth-oidc';

/**
 * The one place Keycloak and Cognito genuinely diverge (plan 029): logout.
 * Keycloak advertises `end_session_endpoint` (standard RP-initiated logout);
 * Cognito omits it and uses a non-standard `/logout?client_id=&logout_uri=` on
 * its hosted domain. `deriveLogoutUrl` must handle both without hardcoding.
 */
describe('deriveLogoutUrl', () => {
  it('Keycloak: standard end_session_endpoint with post_logout_redirect_uri + id_token_hint', () => {
    const u = new URL(
      deriveLogoutUrl(
        {
          end_session_endpoint:
            'https://kc.example.com/realms/v/protocol/openid-connect/logout',
          authorization_endpoint:
            'https://kc.example.com/realms/v/protocol/openid-connect/auth',
        },
        'client-1',
        'https://app.example.com/',
        'id-token-abc',
      ),
    );
    expect(u.origin + u.pathname).toBe(
      'https://kc.example.com/realms/v/protocol/openid-connect/logout',
    );
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe('https://app.example.com/');
    expect(u.searchParams.get('client_id')).toBe('client-1');
    expect(u.searchParams.get('id_token_hint')).toBe('id-token-abc');
  });

  it('Cognito: derives <hosted-domain>/logout?client_id=&logout_uri= from the authorization endpoint', () => {
    const u = new URL(
      deriveLogoutUrl(
        {
          authorization_endpoint:
            'https://myapp.auth.eu-central-1.amazoncognito.com/oauth2/authorize',
        },
        'cognito-client',
        'https://app.example.com/',
        null,
      ),
    );
    expect(u.origin).toBe('https://myapp.auth.eu-central-1.amazoncognito.com');
    expect(u.pathname).toBe('/logout');
    expect(u.searchParams.get('client_id')).toBe('cognito-client');
    expect(u.searchParams.get('logout_uri')).toBe('https://app.example.com/');
    expect(u.searchParams.has('id_token_hint')).toBe(false);
  });

  it('throws when neither an end_session nor an authorization endpoint is known', () => {
    expect(() => deriveLogoutUrl({}, 'c', 'https://app.example.com/', null)).toThrow();
  });
});
