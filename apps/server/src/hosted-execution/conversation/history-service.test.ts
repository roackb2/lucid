import type {
  HostedConversationTurnLifecycleStore,
} from '@heddleagent/execution-host-client/conversation';
import { describe, expect, it, vi } from 'vitest';
import {
  HostedConversationHistoryService,
} from './history-service.js';
import type { HostedConversationHistoryStore } from './store.js';

const NOW = new Date('2026-08-13T12:00:00.000Z');

describe('HostedConversationHistoryService', () => {
  it('reconciles and reads the latest 20 turns in the authenticated user scope', async () => {
    const listRecent = vi.fn<HostedConversationHistoryStore['listRecent']>()
      .mockResolvedValue([{
        invocationId: 'invocation-001',
        prompt: 'Summarize this workspace.',
        status: 'completed',
        summary: '# Public answer',
        failureCode: null,
        requestedAt: NOW.toISOString(),
        settledAt: NOW.toISOString(),
      }]);
    const interruptExpiredTurns = vi.fn<
      HostedConversationTurnLifecycleStore['interruptExpiredTurns']
    >().mockResolvedValue();
    const history = new HostedConversationHistoryService(
      { listRecent },
      lifecycleStore({ interruptExpiredTurns }),
      {
        tenantId: 'tenant-a',
        productSessionId: 'workspace-a',
      },
      { now: () => NOW },
    );

    await expect(history.recentForUser('user-a')).resolves.toEqual([
      expect.objectContaining({ invocationId: 'invocation-001' }),
    ]);
    expect(interruptExpiredTurns).toHaveBeenCalledWith({
      scope: {
        tenantId: 'tenant-a',
        subjectId: 'user-a',
        productSessionId: 'workspace-a',
      },
      expiredBefore: '2026-08-13T11:59:00.000Z',
      settledAt: NOW.toISOString(),
    });
    expect(listRecent).toHaveBeenCalledWith({
      scope: {
        tenantId: 'tenant-a',
        subjectId: 'user-a',
        productSessionId: 'workspace-a',
      },
      limit: 20,
    });
  });
});

function lifecycleStore(input: {
  interruptExpiredTurns:
    HostedConversationTurnLifecycleStore['interruptExpiredTurns'];
}): HostedConversationTurnLifecycleStore {
  return {
    createTurn: vi.fn(),
    recordAccepted: vi.fn(),
    settleTurn: vi.fn(),
    interruptExpiredTurns: input.interruptExpiredTurns,
  };
}
