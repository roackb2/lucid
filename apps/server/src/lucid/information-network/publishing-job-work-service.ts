import type { AgentJobService } from '../agent/jobs/service.js';
import type { AgentJobWorkClaim } from '../agent/jobs/types.js';
import type {
  AgentWorkDisposition,
  AgentWorkResult,
} from '../agent/work-service.js';

export type PublishingJobWorkPreparation =
  | { kind: 'claimed'; work: AgentJobWorkClaim }
  | { kind: 'skipped'; summary: string };

/**
 * Owns the product lifecycle for one explicitly requested publishing run.
 *
 * The Agent-job store is the source of truth for both the execution fence and
 * the Post committed by that run. Runtime completion is evidence, but cannot
 * erase a durable Post when the response stream ends ambiguously.
 */
export class PublishingJobWorkService {
  constructor(
    private readonly agentJobs: Pick<
      AgentJobService,
      | 'claimPendingRun'
      | 'readClaimedRun'
      | 'settleRun'
      | 'failRun'
      | 'interruptRun'
    >,
  ) {}

  async claimWork(input: {
    agentJobId: string;
    executionId: string;
    interruptedExecutionId?: string;
    signal: AbortSignal;
  }): Promise<PublishingJobWorkPreparation> {
    input.signal.throwIfAborted();
    const work = await this.agentJobs.claimPendingRun({
      agentJobId: input.agentJobId,
      executionId: input.executionId,
      ...(input.interruptedExecutionId
        ? { interruptedExecutionId: input.interruptedExecutionId }
        : {}),
    });
    input.signal.throwIfAborted();
    return work
      ? { kind: 'claimed', work }
      : {
          kind: 'skipped',
          summary: 'No explicitly requested publishing run is waiting.',
        };
  }

  async completeWork(input: {
    agentJobId: string;
    executionId: string;
    result: AgentWorkResult;
    signal: AbortSignal;
  }): Promise<AgentWorkDisposition> {
    input.signal.throwIfAborted();
    const work = await this.agentJobs.readClaimedRun(
      input.agentJobId,
      input.executionId,
    );
    if (!work) {
      return { kind: 'accepted' };
    }

    if (work.runRequest.publishedPostId) {
      await this.agentJobs.settleRun({
        agentJobId: input.agentJobId,
        executionId: input.executionId,
        outcome: 'published',
        publishedPostId: work.runRequest.publishedPostId,
      });
      return { kind: 'accepted' };
    }

    if (
      input.result.outcome === 'done'
      && input.result.decision !== 'escalate'
    ) {
      await this.agentJobs.settleRun({
        agentJobId: input.agentJobId,
        executionId: input.executionId,
        outcome: 'no-post',
        outcomeSummary: input.result.summary,
      });
      return { kind: 'accepted' };
    }

    await this.agentJobs.failRun({
      agentJobId: input.agentJobId,
      executionId: input.executionId,
      summary: input.result.summary,
    });
    return { kind: 'accepted' };
  }

  async failWork(input: {
    agentJobId: string;
    executionId: string;
    signal: AbortSignal;
  }): Promise<void> {
    input.signal.throwIfAborted();
    if (!await this.agentJobs.readClaimedRun(
      input.agentJobId,
      input.executionId,
    )) {
      return;
    }
    await this.agentJobs.failRun({
      agentJobId: input.agentJobId,
      executionId: input.executionId,
      summary: 'The hosted execution failed before completing the publishing run.',
    });
  }

  async interruptWork(input: {
    agentJobId: string;
    executionId: string;
    signal: AbortSignal;
  }): Promise<void> {
    input.signal.throwIfAborted();
    await this.agentJobs.interruptRun({
      agentJobId: input.agentJobId,
      executionId: input.executionId,
    });
  }
}
