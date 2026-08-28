import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { HeddleStoredOAuthModelCredentials } from './model-credentials.js';

const stateRoots: string[] = [];

afterEach(() => {
  stateRoots.splice(0).forEach((stateRoot) => {
    rmSync(stateRoot, { force: true, recursive: true });
  });
});

describe('Heddle stored OAuth model credentials', () => {
  it('returns only the request-scoped credential shape', async () => {
    const stateRoot = createStateRoot({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'stored-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: Date.now() + 60 * 60_000,
      accountId: 'account-123',
      createdAt: '2026-08-28T08:00:00.000Z',
      updatedAt: '2026-08-28T08:00:00.000Z',
    });

    const credential = await new HeddleStoredOAuthModelCredentials(
      'gpt-5.4-mini',
      stateRoot,
      11 * 60_000,
    ).resolveModelCredential(context());

    expect(credential).toMatchObject({
      type: 'oauth-access-token',
      provider: 'openai',
      accessToken: 'stored-access-token',
      accountId: 'account-123',
    });
    expect(JSON.stringify(credential)).not.toContain('stored-refresh-token');
  });

  it('fails clearly when the configured Heddle state has no account login', async () => {
    const stateRoot = createStateRoot();

    await expect(new HeddleStoredOAuthModelCredentials(
      'gpt-5.4-mini',
      stateRoot,
      11 * 60_000,
    ).resolveModelCredential(context())).rejects.toThrow(
      'no compatible Heddle account credential',
    );
  });
});

function createStateRoot(credential?: Record<string, unknown>): string {
  const stateRoot = mkdtempSync(join(tmpdir(), 'lucid-hosted-credential-'));
  stateRoots.push(stateRoot);
  writeFileSync(join(stateRoot, 'auth.json'), JSON.stringify({
    version: 1,
    credentials: credential ? { openai: credential } : {},
  }));
  return stateRoot;
}

function context() {
  return {
    scope: {
      tenantId: 'tenant',
      subjectId: 'subject',
      productSessionId: 'session',
    },
    invocationId: 'invocation',
  };
}
