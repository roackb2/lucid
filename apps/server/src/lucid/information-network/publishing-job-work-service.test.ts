import { describe, expect, it, vi } from 'vitest';
import { PublishingJobWorkService } from './publishing-job-work-service.js';

describe('PublishingJobWorkService', () => {
  it('skips before model execution when no manual publishing run is pending', async () => {
    const service = new PublishingJobWorkService(agentJobs({
      claimPendingRun: async () => undefined,
    }));

    await expect(service.claimWork({
      agentJobId: 'publishing-job-1',
      executionId: 'execution-1',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      kind: 'skipped',
      summary: 'No explicitly requested publishing run is waiting.',
    });
  });

  it('settles the durable Post even after an ambiguous Runtime result', async () => {
    const settleRun = vi.fn(async () => undefined);
    const failRun = vi.fn(async () => undefined);
    const service = new PublishingJobWorkService(agentJobs({
      readClaimedRun: async () => ({
        runRequest: { publishedPostId: 'post-1' },
      }),
      settleRun,
      failRun,
    }));

    await expect(service.completeWork({
      agentJobId: 'publishing-job-1',
      executionId: 'execution-1',
      result: {
        decision: 'escalate',
        summary: 'The result stream ended after the tool call.',
        runId: 'run-1',
        outcome: 'error',
      },
      signal: new AbortController().signal,
    })).resolves.toEqual({ kind: 'accepted' });
    expect(settleRun).toHaveBeenCalledWith({
      agentJobId: 'publishing-job-1',
      executionId: 'execution-1',
      outcome: 'published',
      publishedPostId: 'post-1',
    });
    expect(failRun).not.toHaveBeenCalled();
  });

  it('records a truthful no-post outcome when the Agent finishes without publishing', async () => {
    const settleRun = vi.fn(async () => undefined);
    const service = new PublishingJobWorkService(agentJobs({
      readClaimedRun: async () => ({ runRequest: {} }),
      settleRun,
    }));

    await service.completeWork({
      agentJobId: 'publishing-job-1',
      executionId: 'execution-1',
      result: {
        decision: 'complete',
        summary: 'No sufficiently reliable current source was available.',
        runId: 'run-1',
        outcome: 'done',
      },
      signal: new AbortController().signal,
    });

    expect(settleRun).toHaveBeenCalledWith({
      agentJobId: 'publishing-job-1',
      executionId: 'execution-1',
      outcome: 'no-post',
      outcomeSummary: 'No sufficiently reliable current source was available.',
    });
  });
});

function agentJobs(overrides: Record<string, unknown>) {
  return {
    claimPendingRun: async () => undefined,
    readClaimedRun: async () => undefined,
    settleRun: async () => undefined,
    failRun: async () => undefined,
    interruptRun: async () => undefined,
    ...overrides,
  } as never;
}
