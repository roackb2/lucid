import type {
  HostedHeartbeatExecutionPreparationDecision,
  HostedHeartbeatExecutionSettlementInput,
  HostedHeartbeatProductExecutionLifecycle,
} from '@heddleagent/execution-host-client/coordinator';
import {
  agentJobIdFromTaskId,
} from '../../lucid/agent/heartbeat-task-identity.js';
import type { AgentJobService } from '../../lucid/agent/jobs/service.js';
import type { AgentJob } from '../../lucid/agent/jobs/types.js';
import type { AgentWorkService } from '../../lucid/agent/work-service.js';
import type {
  PublishingJobWorkService,
} from '../../lucid/information-network/publishing-job-work-service.js';
import { AGENT_JOB_EXECUTION_POLICIES } from './agent-job-execution-policy.js';

type LucidHeartbeatExecutionPolicy = {
  tenantId: string;
  productSessionId: string;
};

type InterestWork = Pick<
  AgentWorkService,
  'claimWork' | 'completeWork' | 'failWork' | 'interruptWork'
>;

type PublishingWork = Pick<
  PublishingJobWorkService,
  'claimWork' | 'completeWork' | 'failWork' | 'interruptWork'
>;

/** Maps one Coordinator attempt to Lucid's durable product work lifecycle. */
export class LucidHeartbeatExecutionLifecycle
implements HostedHeartbeatProductExecutionLifecycle {
  readonly #policy: Readonly<LucidHeartbeatExecutionPolicy>;

  constructor(
    private readonly agentJobs: Pick<AgentJobService, 'readAgentJob'>,
    private readonly interestWork: InterestWork,
    private readonly publishingWork: PublishingWork,
    policy: LucidHeartbeatExecutionPolicy,
  ) {
    this.#policy = Object.freeze({ ...policy });
  }

  async prepare(input: {
    taskId: string;
    executionId: string;
    interruptedExecutionId?: string;
    signal: AbortSignal;
  }): Promise<HostedHeartbeatExecutionPreparationDecision> {
    const job = await this.#requireAgentJob(input.taskId);
    const preparation = await ({
      'interest-discovery': () => this.interestWork.claimWork({
        agentId: job.agentId,
        executionId: input.executionId,
        ...(input.interruptedExecutionId
          ? { interruptedExecutionId: input.interruptedExecutionId }
          : {}),
        signal: input.signal,
      }),
      'information-network-publishing': () => this.publishingWork.claimWork({
        agentJobId: job.id,
        executionId: input.executionId,
        ...(input.interruptedExecutionId
          ? { interruptedExecutionId: input.interruptedExecutionId }
          : {}),
        signal: input.signal,
      }),
    } satisfies Record<AgentJob['kind'], () => Promise<{
      kind: 'claimed';
      work: { user: { id: string } };
    } | {
      kind: 'skipped';
      summary: string;
    }>>)[job.kind]();
    if (preparation.kind === 'skipped') {
      return { kind: 'skip', summary: preparation.summary };
    }
    const executionPolicy = AGENT_JOB_EXECUTION_POLICIES[job.kind];
    return {
      kind: 'execute',
      authorization: {
        scope: {
          tenantId: this.#policy.tenantId,
          subjectId: preparation.work.user.id,
          productSessionId: this.#policy.productSessionId,
        },
        runtimeToolPolicy: {
          allow: [...executionPolicy.runtimeToolPolicy.allow],
        },
        allowedTools: [...executionPolicy.allowedProductTools],
      },
    };
  }

  async settle(
    input: HostedHeartbeatExecutionSettlementInput,
  ): Promise<
    | { kind: 'accepted' }
    | { kind: 'retry'; summary: string; delayMs: number }
  > {
    const job = await this.#requireAgentJob(input.taskId);
    if (input.kind === 'completed') {
      return await ({
        'interest-discovery': () => this.interestWork.completeWork({
          agentId: job.agentId,
          executionId: input.executionId,
          result: input.result,
          signal: input.signal,
        }),
        'information-network-publishing': () => (
          this.publishingWork.completeWork({
            agentJobId: job.id,
            executionId: input.executionId,
            result: input.result,
            signal: input.signal,
          })
        ),
      } satisfies Record<AgentJob['kind'], () => Promise<
        | { kind: 'accepted' }
        | { kind: 'retry'; summary: string; delayMs: number }
      >>)[job.kind]();
    }
    const settleWithoutResult = input.kind === 'interrupted'
      ? {
          'interest-discovery': () => this.interestWork.interruptWork({
            agentId: job.agentId,
            executionId: input.executionId,
            signal: input.signal,
          }),
          'information-network-publishing': () => (
            this.publishingWork.interruptWork({
              agentJobId: job.id,
              executionId: input.executionId,
              signal: input.signal,
            })
          ),
        }
      : {
          'interest-discovery': () => this.interestWork.failWork({
            agentId: job.agentId,
            executionId: input.executionId,
            signal: input.signal,
          }),
          'information-network-publishing': () => this.publishingWork.failWork({
            agentJobId: job.id,
            executionId: input.executionId,
            signal: input.signal,
          }),
        };
    await settleWithoutResult[job.kind]();
    return { kind: 'accepted' };
  }

  async #requireAgentJob(taskId: string): Promise<AgentJob> {
    const agentJobId = agentJobIdFromTaskId(taskId);
    const job = agentJobId
      ? await this.agentJobs.readAgentJob(agentJobId)
      : undefined;
    if (!job) {
      throw new Error(`Unknown Lucid heartbeat task: ${taskId}`);
    }
    return job;
  }
}
