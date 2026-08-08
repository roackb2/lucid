import { describe, expect, it } from 'vitest';
import { createLucidAuthenticator } from './authenticator.js';

describe('Lucid request authentication', () => {
  it('maps only loopback requests to the explicit development principal', async () => {
    const authenticator = createLucidAuthenticator({ mode: 'development' });

    await expect(authenticator.authenticate({
      remoteAddress: '127.0.0.1',
    })).resolves.toMatchObject({
      participantId: 'local-user',
      roles: ['participant', 'operator'],
    });
    await expect(authenticator.authenticate({
      remoteAddress: '203.0.113.10',
    })).resolves.toBeUndefined();
  });

  it('derives participant and operator roles from distinct bearer tokens', async () => {
    const authenticator = createLucidAuthenticator({
      mode: 'static-token',
      participantToken: 'participant-token-with-at-least-32-characters',
      operatorToken: 'operator-token-with-at-least-32-characters-long',
    });

    await expect(authenticator.authenticate({
      authorization: 'Bearer participant-token-with-at-least-32-characters',
    })).resolves.toMatchObject({ roles: ['participant'] });
    await expect(authenticator.authenticate({
      authorization: 'Bearer operator-token-with-at-least-32-characters-long',
    })).resolves.toMatchObject({ roles: ['participant', 'operator'] });
    await expect(authenticator.authenticate({
      authorization: 'Bearer invalid',
    })).resolves.toBeUndefined();
  });

  it('rejects malformed authorization schemes', async () => {
    const authenticator = createLucidAuthenticator({
      mode: 'static-token',
      participantToken: 'participant-token-with-at-least-32-characters',
      operatorToken: 'operator-token-with-at-least-32-characters-long',
    });

    await expect(authenticator.authenticate({
      authorization: 'Basic participant-token-with-at-least-32-characters',
    })).resolves.toBeUndefined();
  });
});
