import type { ExecutionHostStreamEvent } from '@roackb2/heddle-adopter/contracts';
import { ExecutionHostStreamInterruptedError } from '@roackb2/heddle-adopter/http-sse';
import { describe, expect, it } from 'vitest';
import {
  createTestConversationHistory,
} from './history.test-support.js';

const NOW = new Date('2026-08-13T12:00:00.000Z');

describe('HostedConversationHistoryService', () => {
  it.each([
    ['done', 'completed'],
    ['max_steps', 'max_steps'],
    ['error', 'failed'],
    ['interrupted', 'interrupted'],
  ] as const)('projects result outcome %s as %s', async (outcome, status) => {
    const { history, store } = createTestConversationHistory({
      now: () => NOW,
    });
    await history.createTurn({
      invocationId: 'invocation-001',
      userId: 'user-a',
      prompt: 'Summarize this workspace.',
      deadlineAt: '2026-08-13T12:01:00.000Z',
    });
    await history.recordAccepted({
      invocationId: 'invocation-001',
      userId: 'user-a',
      runId: 'run-001',
      acceptedAt: NOW.toISOString(),
    });

    await history.recordTerminal('user-a', resultEvent(outcome));

    expect(store.turns.get('invocation-001')).toMatchObject({
      status,
      answerMarkdown: '# Public answer',
      errorCode: outcome === 'error'
        ? 'model_rate_limit'
        : outcome === 'interrupted'
          ? 'execution_interrupted'
          : null,
    });
  });

  it('stores a safe public code but not a terminal error message', async () => {
    const { history, store } = createTestConversationHistory({
      now: () => NOW,
    });
    await history.createTurn({
      invocationId: 'invocation-001',
      userId: 'user-a',
      prompt: 'Try one bounded operation.',
      deadlineAt: '2026-08-13T12:01:00.000Z',
    });

    await history.recordTerminal('user-a', {
      schemaVersion: 1,
      invocationId: 'invocation-001',
      runId: 'run-001',
      sequence: 1,
      timestamp: NOW.toISOString(),
      kind: 'error',
      error: {
        code: 'github_pat_secret_shaped_value',
        message: 'Private upstream detail must not be persisted.',
      },
    });

    expect(store.turns.get('invocation-001')).toMatchObject({
      status: 'failed',
      errorCode: 'execution_error',
    });
    expect(JSON.stringify(store.turns.get('invocation-001')))
      .not.toContain('Private upstream detail');
    expect(JSON.stringify(store.turns.get('invocation-001')))
      .not.toContain('github_pat_secret_shaped_value');
  });

  it('records only an explicit terminal cancellation as cancelled', async () => {
    const { history, store } = createTestConversationHistory({
      now: () => NOW,
    });
    await history.createTurn({
      invocationId: 'invocation-001',
      userId: 'user-a',
      prompt: 'Stop when asked.',
      deadlineAt: '2026-08-13T12:01:00.000Z',
    });

    await history.recordTerminal('user-a', {
      schemaVersion: 1,
      invocationId: 'invocation-001',
      runId: 'run-001',
      sequence: 1,
      timestamp: NOW.toISOString(),
      kind: 'cancelled',
      reason: 'Cancelled by the execution owner.',
    });

    expect(store.turns.get('invocation-001')).toMatchObject({
      status: 'cancelled',
      errorCode: 'invocation_cancelled',
    });
    expect(JSON.stringify(store.turns.get('invocation-001')))
      .not.toContain('execution owner');
  });

  it('distinguishes infrastructure interruption from dependency failure', async () => {
    const cases = [
      {
        invocationId: 'aborted',
        error: new Error('closed'),
        signal: abortedSignal(),
        status: 'interrupted',
      },
      {
        invocationId: 'interrupted',
        error: new ExecutionHostStreamInterruptedError(),
        signal: new AbortController().signal,
        status: 'interrupted',
      },
      {
        invocationId: 'failed',
        error: new Error('dependency unavailable'),
        signal: new AbortController().signal,
        status: 'failed',
      },
    ] as const;
    const { history, store } = createTestConversationHistory({
      now: () => NOW,
    });
    for (const item of cases) {
      await history.createTurn({
        invocationId: item.invocationId,
        userId: 'user-a',
        prompt: 'Run.',
        deadlineAt: '2026-08-13T12:01:00.000Z',
      });
      await history.recordThrownFailure({
        invocationId: item.invocationId,
        userId: 'user-a',
        error: item.error,
        signal: item.signal,
      });
      expect(store.turns.get(item.invocationId)?.status).toBe(item.status);
    }
  });

  it('reconciles expired open turns and returns only the latest 20 for one user', async () => {
    const { history, store } = createTestConversationHistory({
      now: () => NOW,
    });
    for (let index = 0; index < 22; index += 1) {
      const timestamp = new Date(NOW.getTime() - index * 1_000).toISOString();
      await store.createTurn({
        invocationId: `invocation-${index.toString().padStart(2, '0')}`,
        workspaceId: 'local-discovery-workspace',
        userId: 'user-a',
        prompt: `Question ${index}`,
        deadlineAt: index === 0
          ? '2026-08-13T11:58:00.000Z'
          : '2026-08-13T12:10:00.000Z',
        createdAt: timestamp,
      });
    }
    await store.createTurn({
      invocationId: 'another-user',
      workspaceId: 'local-discovery-workspace',
      userId: 'user-b',
      prompt: 'Private question for B',
      deadlineAt: '2026-08-13T12:10:00.000Z',
      createdAt: NOW.toISOString(),
    });

    const recent = await history.recentForUser('user-a');

    expect(recent).toHaveLength(20);
    expect(recent[0]).toMatchObject({
      invocationId: 'invocation-00',
      status: 'interrupted',
      errorCode: 'execution_deadline_elapsed',
    });
    expect(recent.map(({ invocationId }) => invocationId))
      .not.toContain('another-user');
    expect(store.operations).toContain('list:user-a:20');
  });
});

function resultEvent(
  outcome: 'done' | 'max_steps' | 'error' | 'interrupted',
): Extract<ExecutionHostStreamEvent, { kind: 'result' }> {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-001',
    runId: 'run-001',
    sequence: 1,
    timestamp: NOW.toISOString(),
    kind: 'result',
    result: {
      outcome,
      summary: '# Public answer',
      failure: outcome === 'error'
        ? { source: 'model', code: 'rate_limit' }
        : undefined,
    },
  };
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}
