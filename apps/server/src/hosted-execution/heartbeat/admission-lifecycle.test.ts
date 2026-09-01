import { describe, expect, it, vi } from 'vitest';
import {
  LUCID_BACKGROUND_WORK_GROUP_ID,
} from '../../lucid/agent/heartbeat-task-identity.js';
import { LucidBackgroundChecksAdmissionLifecycle } from './admission-lifecycle.js';

const TARGET = {
  kind: 'group' as const,
  groupId: LUCID_BACKGROUND_WORK_GROUP_ID,
};

describe('LucidBackgroundChecksAdmissionLifecycle', () => {
  it('returns ready only after Lucid commits the matching fresh boundary', async () => {
    const prepareBackgroundChecksResume = vi.fn(async () => ({
      status: 'prepared' as const,
      admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
      transitionId: 'transition-1',
      mailboxFloorSequence: 42,
      agentCount: 2,
      preparedAt: '2026-09-01T00:00:00.000Z',
    }));
    const lifecycle = new LucidBackgroundChecksAdmissionLifecycle({
      prepareBackgroundChecksResume,
    });

    await expect(lifecycle.prepareResume({
      schemaVersion: 1,
      target: TARGET,
      transitionId: 'transition-1',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      status: 'ready',
      summary: 'Lucid prepared a fresh background-work boundary.',
    });
    expect(prepareBackgroundChecksResume).toHaveBeenCalledWith({
      admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
      transitionId: 'transition-1',
    });
  });

  it('keeps provider admission preparing while a wake is still running', async () => {
    const lifecycle = new LucidBackgroundChecksAdmissionLifecycle({
      prepareBackgroundChecksResume: async () => ({
        status: 'waiting' as const,
        reason: 'agent-wake-running' as const,
        runningAgentIds: ['agent-1'],
      }),
    });

    await expect(lifecycle.prepareResume({
      schemaVersion: 1,
      target: TARGET,
      transitionId: 'transition-2',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      status: 'retry',
      summary: 'Lucid is waiting for an active background check to settle.',
      retryAfterMs: 5_000,
    });
  });

  it('blocks disabled or foreign product admission', async () => {
    const prepareBackgroundChecksResume = vi.fn(async () => ({
      status: 'waiting' as const,
      reason: 'background-checks-disabled' as const,
      runningAgentIds: [],
    }));
    const lifecycle = new LucidBackgroundChecksAdmissionLifecycle({
      prepareBackgroundChecksResume,
    });

    await expect(lifecycle.prepareResume({
      schemaVersion: 1,
      target: TARGET,
      transitionId: 'transition-3',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'blocked' });
    await expect(lifecycle.prepareResume({
      schemaVersion: 1,
      target: { kind: 'group', groupId: 'foreign-group' },
      transitionId: 'transition-4',
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'blocked' });
    expect(prepareBackgroundChecksResume).toHaveBeenCalledOnce();
  });
});
