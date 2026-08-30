import { describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  AgentWorkClaim,
  User,
} from '../../lucid/discovery-types.js';
import { taskIdForAgent } from '../../lucid/agent/heartbeat-task-identity.js';
import { LucidHeartbeatExecutionLifecycle } from './execution-lifecycle.js';

describe('LucidHeartbeatExecutionLifecycle', () => {
  it('claims product work before returning current Lucid authority', async () => {
    const claimWork = vi.fn(async () => ({
      kind: 'claimed' as const,
      work: workClaim(),
    }));
    const lifecycle = new LucidHeartbeatExecutionLifecycle({
      claimWork,
      completeWork: async () => ({ kind: 'accepted' }),
      failWork: async () => undefined,
      interruptWork: async () => undefined,
    }, {
      tenantId: 'tenant-1',
      productSessionId: 'workspace-1',
      allowedTools: ['read_available_messages', 'post_shared_message'],
    });

    await expect(lifecycle.prepare({
      taskId: taskIdForAgent('agent-1'),
      executionId: 'execution-1',
      interruptedExecutionId: 'execution-0',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      kind: 'execute',
      authorization: {
        scope: {
          tenantId: 'tenant-1',
          subjectId: 'user-1',
          productSessionId: 'workspace-1',
        },
        allowedTools: ['read_available_messages', 'post_shared_message'],
      },
    });
    expect(claimWork).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      executionId: 'execution-1',
      interruptedExecutionId: 'execution-0',
    }));
  });

  it('returns an explicit pre-model skip when Lucid has no product work', async () => {
    const lifecycle = new LucidHeartbeatExecutionLifecycle({
      claimWork: async () => ({
        kind: 'skipped',
        summary: 'No current Interest is available for this agent.',
      }),
      completeWork: async () => ({ kind: 'accepted' }),
      failWork: async () => undefined,
      interruptWork: async () => undefined,
    }, {
      tenantId: 'tenant-1',
      productSessionId: 'workspace-1',
      allowedTools: [],
    });

    await expect(lifecycle.prepare({
      taskId: taskIdForAgent('agent-1'),
      executionId: 'execution-1',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      kind: 'skip',
      summary: 'No current Interest is available for this agent.',
    });
  });

  it('settles completed work through the same execution fence', async () => {
    const completeWork = vi.fn(async () => ({
      kind: 'retry' as const,
      summary: 'Required product effect is missing.',
      delayMs: 10_000,
    }));
    const lifecycle = new LucidHeartbeatExecutionLifecycle({
      claimWork: async () => ({ kind: 'claimed', work: workClaim() }),
      completeWork,
      failWork: async () => undefined,
      interruptWork: async () => undefined,
    }, {
      tenantId: 'tenant-1',
      productSessionId: 'workspace-1',
      allowedTools: [],
    });

    await expect(lifecycle.settle({
      schemaVersion: 1,
      kind: 'completed',
      taskId: taskIdForAgent('agent-1'),
      executionId: 'execution-1',
      result: {
        decision: 'complete',
        summary: 'Done.',
        runId: 'run-1',
        outcome: 'done',
      },
      signal: new AbortController().signal,
    })).resolves.toEqual({
      kind: 'retry',
      summary: 'Required product effect is missing.',
      delayMs: 10_000,
    });
    expect(completeWork).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      executionId: 'execution-1',
    }));
  });
});

function workClaim(): AgentWorkClaim {
  const timestamp = '2026-08-19T00:00:00.000Z';
  const user: User = {
    id: 'user-1',
    workspaceId: 'workspace-1',
    kind: 'human',
    status: 'active',
    displayName: 'User',
    privateContext: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const agent: Agent = {
    id: 'agent-1',
    workspaceId: 'workspace-1',
    userId: user.id,
    sortOrder: 0,
    name: 'Agent',
    role: 'representative',
    color: 'green',
    purpose: 'Represent the user',
    instructions: '',
    status: 'running',
    runCount: 1,
    mailboxFloorSequence: 0,
    lastSeenSequence: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    agent,
    user,
    workId: 'work-1',
    executionId: 'execution-1',
    workNumber: 1,
    visibleEvents: [],
    horizonSequence: 1,
    workingContext: { principalInputs: [], findings: [] },
  };
}
