import { describe, expect, it, vi } from 'vitest';
import type { AgentJobStore } from './store.js';
import { AgentJobInputError, AgentJobService } from './service.js';

describe('Agent job service', () => {
  it('normalizes the stable Interest-job initializer', async () => {
    const store = createStore();
    const service = new AgentJobService(store, {
      now: () => '2026-09-04T07:00:00.000Z',
    });

    await service.ensureInterestDiscoveryJob(' agent-1 ', 10_800_000);

    expect(store.ensureInterestDiscoveryJob).toHaveBeenCalledWith({
      agentId: 'agent-1',
      cadenceMs: 10_800_000,
      createdAt: '2026-09-04T07:00:00.000Z',
    });
    await expect(service.ensureInterestDiscoveryJob('agent-1', 9_999))
      .rejects.toBeInstanceOf(AgentJobInputError);
  });

  it('creates normalized, retry-stable manual run intent', async () => {
    const store = createStore();
    const service = new AgentJobService(store, {
      createId: () => 'stable-request',
      now: () => '2026-09-04T07:00:00.000Z',
    });

    await service.requestRunOnce(' publisher-job ');

    expect(store.requestRunOnce).toHaveBeenCalledWith({
      agentJobId: 'publisher-job',
      runRequestId: 'agent-job-run_stable-request',
      requestedAt: '2026-09-04T07:00:00.000Z',
    });
  });

  it('requires the persisted Post identity to match a published outcome', async () => {
    const store = createStore();
    const service = new AgentJobService(store);

    await expect(service.settleRun({
      agentJobId: 'publisher-job',
      executionId: 'execution-1',
      outcome: 'published',
    })).rejects.toBeInstanceOf(AgentJobInputError);
    await expect(service.settleRun({
      agentJobId: 'publisher-job',
      executionId: 'execution-1',
      outcome: 'no-post',
      publishedPostId: 'post-1',
    })).rejects.toBeInstanceOf(AgentJobInputError);
    expect(store.settleRun).not.toHaveBeenCalled();
  });

  it('normalizes terminal outcome summaries before persistence', async () => {
    const store = createStore();
    const service = new AgentJobService(store, {
      now: () => '2026-09-04T07:05:00.000Z',
    });

    await service.settleRun({
      agentJobId: 'publisher-job',
      executionId: 'execution-1',
      outcome: 'no-post',
      outcomeSummary: '  No reliable source was found.  ',
    });
    await service.failRun({
      agentJobId: 'publisher-job',
      executionId: 'execution-2',
      summary: '  Runtime request failed.  ',
    });

    expect(store.settleRun).toHaveBeenCalledWith({
      agentJobId: 'publisher-job',
      executionId: 'execution-1',
      outcome: 'no-post',
      publishedPostId: undefined,
      outcomeSummary: 'No reliable source was found.',
      settledAt: '2026-09-04T07:05:00.000Z',
    });
    expect(store.failRun).toHaveBeenCalledWith({
      agentJobId: 'publisher-job',
      executionId: 'execution-2',
      outcomeSummary: 'Runtime request failed.',
      settledAt: '2026-09-04T07:05:00.000Z',
    });
  });
});

function createStore(): AgentJobStore {
  return {
    ensureInterestDiscoveryJob: vi.fn(async (input) => ({
      id: input.agentId,
      workspaceId: 'lucid-workspace',
      agentId: input.agentId,
      kind: 'interest-discovery' as const,
      name: 'Interest discovery',
      instructions: 'Review the current Interest.',
      cadenceMs: input.cadenceMs,
      enabled: true,
      scheduleMode: 'scheduled' as const,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })),
    listAgentJobs: vi.fn(async () => []),
    readAgentJob: vi.fn(async () => undefined),
    readLatestRunRequest: vi.fn(async () => undefined),
    requestRunOnce: vi.fn(async (input) => ({
      outcome: 'requested' as const,
      request: {
        id: input.runRequestId,
        agentJobId: input.agentJobId,
        state: 'requested' as const,
        requestedAt: input.requestedAt,
      },
    })),
    claimPendingRun: vi.fn(async () => undefined),
    readClaimedRun: vi.fn(async () => undefined),
    settleRun: vi.fn(async () => undefined),
    failRun: vi.fn(async () => undefined),
    interruptRun: vi.fn(async () => undefined),
  };
}
