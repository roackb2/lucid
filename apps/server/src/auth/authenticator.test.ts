import { describe, expect, it } from 'vitest';
import { createLucidAuthenticator } from './authenticator.js';

describe('Lucid request authentication', () => {
  it('maps only loopback requests to the explicit development principal', async () => {
    const authenticator = createLucidAuthenticator({ mode: 'development' });

    await expect(authenticator.authenticate({
      remoteAddress: '127.0.0.1',
    })).resolves.toMatchObject({
      userId: 'local-user',
      roles: ['user', 'operator'],
    });
    await expect(authenticator.authenticate({
      remoteAddress: '203.0.113.10',
    })).resolves.toBeUndefined();
  });

  it('derives user and operator roles from distinct bearer tokens', async () => {
    const authenticator = createLucidAuthenticator({
      mode: 'static-token',
      userToken: 'user-token-with-at-least-32-characters',
      operatorToken: 'operator-token-with-at-least-32-characters-long',
    });

    await expect(authenticator.authenticate({
      authorization: 'Bearer user-token-with-at-least-32-characters',
    })).resolves.toMatchObject({ roles: ['user'] });
    await expect(authenticator.authenticate({
      authorization: 'Bearer operator-token-with-at-least-32-characters-long',
    })).resolves.toMatchObject({ roles: ['user', 'operator'] });
    await expect(authenticator.authenticate({
      authorization: 'Bearer invalid',
    })).resolves.toBeUndefined();
  });

  it('rejects malformed authorization schemes', async () => {
    const authenticator = createLucidAuthenticator({
      mode: 'static-token',
      userToken: 'user-token-with-at-least-32-characters',
      operatorToken: 'operator-token-with-at-least-32-characters-long',
    });

    await expect(authenticator.authenticate({
      authorization: 'Basic user-token-with-at-least-32-characters',
    })).resolves.toBeUndefined();
  });
});
