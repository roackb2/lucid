import type {
  HostedHeartbeatExecutionPreparationDecision,
  HostedHeartbeatExecutionSettlementInput,
  HostedHeartbeatProductExecutionLifecycle,
} from '@heddleagent/execution-host-client/coordinator';
import { agentIdFromTask } from '../../lucid/agent/heartbeat-task-identity.js';
import type { AgentWorkService } from '../../lucid/agent/work-service.js';

type LucidHeartbeatExecutionPolicy = {
  tenantId: string;
  productSessionId: string;
  allowedTools: readonly string[];
};

/** Maps one Coordinator attempt to Lucid's durable product work lifecycle. */
export class LucidHeartbeatExecutionLifecycle
implements HostedHeartbeatProductExecutionLifecycle {
  readonly #policy: Readonly<LucidHeartbeatExecutionPolicy>;

  constructor(
    private readonly work: Pick<
      AgentWorkService,
      'claimWork' | 'completeWork' | 'failWork' | 'interruptWork'
    >,
    policy: LucidHeartbeatExecutionPolicy,
  ) {
    this.#policy = Object.freeze({
      ...policy,
      allowedTools: Object.freeze([...policy.allowedTools]),
    });
  }

  async prepare(input: {
    taskId: string;
    executionId: string;
    interruptedExecutionId?: string;
    signal: AbortSignal;
  }): Promise<HostedHeartbeatExecutionPreparationDecision> {
    const agentId = requireAgentId(input.taskId);
    const preparation = await this.work.claimWork({
      agentId,
      executionId: input.executionId,
      ...(input.interruptedExecutionId
        ? { interruptedExecutionId: input.interruptedExecutionId }
        : {}),
      signal: input.signal,
    });
    if (preparation.kind === 'skipped') {
      return { kind: 'skip', summary: preparation.summary };
    }
    return {
      kind: 'execute',
      authorization: {
        scope: {
          tenantId: this.#policy.tenantId,
          subjectId: preparation.work.user.id,
          productSessionId: this.#policy.productSessionId,
        },
        allowedTools: [...this.#policy.allowedTools],
      },
    };
  }

  async settle(
    input: HostedHeartbeatExecutionSettlementInput,
  ): Promise<
    | { kind: 'accepted' }
    | { kind: 'retry'; summary: string; delayMs: number }
  > {
    const agentId = requireAgentId(input.taskId);
    if (input.kind === 'completed') {
      return await this.work.completeWork({
        agentId,
        executionId: input.executionId,
        result: input.result,
        signal: input.signal,
      });
    }
    if (input.kind === 'interrupted') {
      await this.work.interruptWork({
        agentId,
        executionId: input.executionId,
        signal: input.signal,
      });
      return { kind: 'accepted' };
    }
    await this.work.failWork({
      agentId,
      executionId: input.executionId,
      signal: input.signal,
    });
    return { kind: 'accepted' };
  }
}

function requireAgentId(taskId: string): string {
  const agentId = agentIdFromTask(taskId);
  if (!agentId) {
    throw new Error(`Unknown Lucid heartbeat task: ${taskId}`);
  }
  return agentId;
}
