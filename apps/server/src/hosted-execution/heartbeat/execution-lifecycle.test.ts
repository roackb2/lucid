import { describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  AgentWorkClaim,
  User,
} from '../../lucid/discovery-types.js';
import {
  taskIdForAgentJob,
} from '../../lucid/agent/heartbeat-task-identity.js';
import type { AgentJob } from '../../lucid/agent/jobs/types.js';
import { LucidHeartbeatExecutionLifecycle } from './execution-lifecycle.js';

describe('LucidHeartbeatExecutionLifecycle', () => {
  it('claims product work before returning current Lucid authority', async () => {
    const claimWork = vi.fn(async () => ({
      kind: 'claimed' as const,
      work: workClaim(),
    }));
    const lifecycle = new LucidHeartbeatExecutionLifecycle(agentJobs(), {
      claimWork,
      completeWork: async () => ({ kind: 'accepted' }),
      failWork: async () => undefined,
      interruptWork: async () => undefined,
    }, publishingWork(), {
      tenantId: 'tenant-1',
      productSessionId: 'workspace-1',
    });

    await expect(lifecycle.prepare({
      taskId: taskIdForAgentJob('agent-1'),
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
        runtimeToolPolicy: { allow: [] },
        allowedTools: [
          'read_working_context',
          'search_network_posts',
          'read_network_post',
          'read_available_messages',
          'read_open_requests',
          'update_working_note',
          'post_shared_message',
          'send_direct_message',
          'report_finding',
          'finish_without_action',
        ],
      },
    });
    expect(claimWork).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      executionId: 'execution-1',
      interruptedExecutionId: 'execution-0',
    }));
  });

  it('returns an explicit pre-model skip when Lucid has no product work', async () => {
    const lifecycle = new LucidHeartbeatExecutionLifecycle(agentJobs(), {
      claimWork: async () => ({
        kind: 'skipped',
        summary: 'No current Interest is available for this agent.',
      }),
      completeWork: async () => ({ kind: 'accepted' }),
      failWork: async () => undefined,
      interruptWork: async () => undefined,
    }, publishingWork(), {
      tenantId: 'tenant-1',
      productSessionId: 'workspace-1',
    });

    await expect(lifecycle.prepare({
      taskId: taskIdForAgentJob('agent-1'),
      executionId: 'execution-1',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      kind: 'skip',
      summary: 'No current Interest is available for this agent.',
    });
  });

  it('gives a publishing run only web search and Post publication', async () => {
    const publishClaim = vi.fn(async () => ({
      kind: 'claimed' as const,
      work: { user: workClaim().user },
    }));
    const lifecycle = new LucidHeartbeatExecutionLifecycle(
      agentJobs({
        ...interestJob(),
        id: 'publishing-job-1',
        kind: 'information-network-publishing',
        scheduleMode: 'manual',
      }),
      {
        claimWork: async () => {
          throw new Error('Interest work must not be claimed.');
        },
        completeWork: async () => ({ kind: 'accepted' }),
        failWork: async () => undefined,
        interruptWork: async () => undefined,
      },
      publishingWork({ claimWork: publishClaim }),
      { tenantId: 'tenant-1', productSessionId: 'workspace-1' },
    );

    await expect(lifecycle.prepare({
      taskId: taskIdForAgentJob('publishing-job-1'),
      executionId: 'execution-1',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      kind: 'execute',
      authorization: {
        scope: {
          tenantId: 'tenant-1',
          subjectId: 'user-1',
          productSessionId: 'workspace-1',
        },
        runtimeToolPolicy: { allow: ['web_search'] },
        allowedTools: ['publish_text_post'],
      },
    });
    expect(publishClaim).toHaveBeenCalledWith(expect.objectContaining({
      agentJobId: 'publishing-job-1',
      executionId: 'execution-1',
    }));
  });

  it('settles completed work through the same execution fence', async () => {
    const completeWork = vi.fn(async () => ({
      kind: 'retry' as const,
      summary: 'Required product effect is missing.',
      delayMs: 10_000,
    }));
    const lifecycle = new LucidHeartbeatExecutionLifecycle(agentJobs(), {
      claimWork: async () => ({ kind: 'claimed', work: workClaim() }),
      completeWork,
      failWork: async () => undefined,
      interruptWork: async () => undefined,
    }, publishingWork(), {
      tenantId: 'tenant-1',
      productSessionId: 'workspace-1',
    });

    await expect(lifecycle.settle({
      schemaVersion: 1,
      kind: 'completed',
      taskId: taskIdForAgentJob('agent-1'),
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

function agentJobs(job: AgentJob = interestJob()) {
  return {
    readAgentJob: async (agentJobId: string) => (
      agentJobId === job.id ? job : undefined
    ),
  };
}

function interestJob(): AgentJob {
  return {
    id: 'agent-1',
    workspaceId: 'workspace-1',
    agentId: 'agent-1',
    kind: 'interest-discovery',
    name: 'Interest discovery',
    instructions: 'Review the current Interest.',
    cadenceMs: 10_800_000,
    enabled: true,
    scheduleMode: 'scheduled',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
}

function publishingWork(overrides: Record<string, unknown> = {}) {
  return {
    claimWork: async () => ({
      kind: 'skipped' as const,
      summary: 'No explicitly requested publishing run is waiting.',
    }),
    completeWork: async () => ({ kind: 'accepted' as const }),
    failWork: async () => undefined,
    interruptWork: async () => undefined,
    ...overrides,
  } as never;
}

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
