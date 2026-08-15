import type {
  HostedConversationPersistenceScope,
} from '@heddleagent/execution-host-client/conversation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { LOCAL_USER_ID } from '../../lucid/local-user.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../../lucid/persistence/postgres/test-context.js';

const TENANT_ID = 'lucid-test';
const PRODUCT_SESSION_ID = 'local-discovery-workspace';
const NOW = '2026-08-13T12:00:00.000Z';
const DEADLINE = '2026-08-13T12:05:00.000Z';

describe('PostgresHostedConversationHistoryStore', () => {
  let database: PostgresDatabase | undefined;
  let stores: PostgresTestStores['stores'];

  beforeEach(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-hosted-conversation-history-test',
    }));
  });

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('retains a terminal answer across reconnect and scopes it to one user', async () => {
    const other = await stores.network.registerUser({
      registrationKey: 'test:conversation:user-b',
      kind: 'synthetic',
      displayName: 'User B',
      privateContext: 'Private B context.',
    });
    await createCompletedTurn(
      scopeFor(LOCAL_USER_ID),
      'invocation-user-a',
      'Question A',
      '## Durable A answer',
    );
    await createCompletedTurn(
      scopeFor(other.user.id),
      'invocation-user-b',
      'Question B',
      '## Private B answer',
    );

    await database!.close();
    database = undefined;
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-hosted-conversation-history-reconnect-test',
      reset: false,
    }));

    const userA = await stores.conversationHistory.listRecent({
      scope: scopeFor(LOCAL_USER_ID),
      limit: 20,
    });
    expect(userA).toEqual([
      expect.objectContaining({
        invocationId: 'invocation-user-a',
        status: 'completed',
        summary: '## Durable A answer',
      }),
    ]);
    expect(JSON.stringify(userA)).not.toContain('Private B answer');
  });

  it('returns the deterministic newest 20 turns', async () => {
    const scope = scopeFor(LOCAL_USER_ID);
    for (let index = 0; index < 22; index += 1) {
      await stores.conversationLifecycle.createTurn({
        invocationId: `invocation-${index.toString().padStart(2, '0')}`,
        scope,
        prompt: `Question ${index}`,
        deadlineAt: DEADLINE,
        requestedAt: new Date(
          Date.parse(NOW) + index * 1_000,
        ).toISOString(),
      });
    }

    const recent = await stores.conversationHistory.listRecent({
      scope,
      limit: 20,
    });

    expect(recent).toHaveLength(20);
    expect(recent[0]?.invocationId).toBe('invocation-21');
    expect(recent.at(-1)?.invocationId).toBe('invocation-02');
  });

  async function createCompletedTurn(
    scope: HostedConversationPersistenceScope,
    invocationId: string,
    prompt: string,
    summary: string,
  ): Promise<void> {
    await stores.conversationLifecycle.createTurn({
      invocationId,
      scope,
      prompt,
      deadlineAt: DEADLINE,
      requestedAt: NOW,
    });
    await stores.conversationLifecycle.recordAccepted({
      invocationId,
      scope,
      runId: `run-${invocationId}`,
      acceptedAt: NOW,
    });
    await stores.conversationLifecycle.settleTurn({
      invocationId,
      scope,
      status: 'completed',
      summary,
      settledAt: NOW,
    });
  }
});

function scopeFor(subjectId: string): HostedConversationPersistenceScope {
  return {
    tenantId: TENANT_ID,
    subjectId,
    productSessionId: PRODUCT_SESSION_ID,
  };
}
