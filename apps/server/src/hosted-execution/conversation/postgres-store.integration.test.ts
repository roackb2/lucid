import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { LOCAL_USER_ID } from '../../lucid/local-user.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../../lucid/persistence/postgres/test-context.js';

const WORKSPACE_ID = 'local-discovery-workspace';
const NOW = '2026-08-13T12:00:00.000Z';
const DEADLINE = '2026-08-13T12:05:00.000Z';

describe('PostgresHostedConversationTurnStore', () => {
  let database: PostgresDatabase | undefined;
  let stores: PostgresTestStores['stores'];

  beforeEach(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-hosted-conversation-store-test',
    }));
  });

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('persists terminal Markdown across reconnect and scopes it to one user', async () => {
    const other = await stores.network.registerUser({
      registrationKey: 'test:conversation:user-b',
      kind: 'synthetic',
      displayName: 'User B',
      privateContext: 'Private B context.',
    });
    await createCompletedTurn({
      invocationId: 'invocation-user-a',
      userId: LOCAL_USER_ID,
      prompt: 'Question A',
      answerMarkdown: '## Durable A answer',
    });
    await createCompletedTurn({
      invocationId: 'invocation-user-b',
      userId: other.user.id,
      prompt: 'Question B',
      answerMarkdown: '## Private B answer',
    });

    await database!.close();
    database = undefined;
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-hosted-conversation-store-reconnect-test',
      reset: false,
    }));

    const userA = await stores.conversation.listRecentForUser({
      workspaceId: WORKSPACE_ID,
      userId: LOCAL_USER_ID,
      limit: 20,
    });
    expect(userA).toEqual([
      expect.objectContaining({
        invocationId: 'invocation-user-a',
        status: 'completed',
        answerMarkdown: '## Durable A answer',
      }),
    ]);
    expect(JSON.stringify(userA)).not.toContain('Private B answer');
  });

  it('returns the deterministic newest 20 turns', async () => {
    for (let index = 0; index < 22; index += 1) {
      const createdAt = new Date(
        Date.parse(NOW) + index * 1_000,
      ).toISOString();
      await stores.conversation.createTurn({
        invocationId: `invocation-${index.toString().padStart(2, '0')}`,
        workspaceId: WORKSPACE_ID,
        userId: LOCAL_USER_ID,
        prompt: `Question ${index}`,
        deadlineAt: DEADLINE,
        createdAt,
      });
    }

    const recent = await stores.conversation.listRecentForUser({
      workspaceId: WORKSPACE_ID,
      userId: LOCAL_USER_ID,
      limit: 20,
    });

    expect(recent).toHaveLength(20);
    expect(recent[0]?.invocationId).toBe('invocation-21');
    expect(recent.at(-1)?.invocationId).toBe('invocation-02');
  });

  it('fences conflicting late settlement while accepting an identical retry', async () => {
    await createCompletedTurn({
      invocationId: 'invocation-fenced',
      userId: LOCAL_USER_ID,
      prompt: 'Settle exactly once.',
      answerMarkdown: 'Completed once.',
    });
    const duplicate = await stores.conversation.settleTurn({
      invocationId: 'invocation-fenced',
      workspaceId: WORKSPACE_ID,
      userId: LOCAL_USER_ID,
      status: 'completed',
      answerMarkdown: 'Completed once.',
      settledAt: NOW,
    });
    expect(duplicate.status).toBe('completed');

    await expect(stores.conversation.settleTurn({
      invocationId: 'invocation-fenced',
      workspaceId: WORKSPACE_ID,
      userId: LOCAL_USER_ID,
      status: 'failed',
      errorCode: 'execution_failed',
      settledAt: NOW,
    })).rejects.toThrow('cannot transition to failed');
  });

  async function createCompletedTurn(input: {
    invocationId: string;
    userId: string;
    prompt: string;
    answerMarkdown: string;
  }): Promise<void> {
    await stores.conversation.createTurn({
      invocationId: input.invocationId,
      workspaceId: WORKSPACE_ID,
      userId: input.userId,
      prompt: input.prompt,
      deadlineAt: DEADLINE,
      createdAt: NOW,
    });
    await stores.conversation.recordAccepted({
      invocationId: input.invocationId,
      workspaceId: WORKSPACE_ID,
      userId: input.userId,
      runId: `run-${input.invocationId}`,
      acceptedAt: NOW,
    });
    await stores.conversation.settleTurn({
      invocationId: input.invocationId,
      workspaceId: WORKSPACE_ID,
      userId: input.userId,
      status: 'completed',
      answerMarkdown: input.answerMarkdown,
      settledAt: NOW,
    });
  }
});
