import type {
  ExecutionAuthority,
  IssuedExecutionAuthorityMetadata,
} from '@heddleagent/execution-host-client/authority';
import {
  HEARTBEAT_TASK_WORKFLOW,
  OpaqueIdSchema,
} from '@heddleagent/execution-host-client/contracts';
import dayjs from 'dayjs';
import { z } from 'zod';
import { agentIdFromTask } from '../../lucid/agent/heartbeat-task-identity.js';
import type { AgentWakeStore } from '../../lucid/agent/store.js';
import { createHostedRuntimeSessionId } from '../runtime-session-id.js';

export const HOSTED_HEARTBEAT_DELEGATIONS_PATH =
  '/hosted-execution/internal/heartbeat-delegations';

export const HostedHeartbeatDelegationRequestSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: OpaqueIdSchema,
  executionId: OpaqueIdSchema,
}).strict();

export type HostedHeartbeatDelegationRequest = z.infer<
  typeof HostedHeartbeatDelegationRequestSchema
>;

export type HostedHeartbeatDelegation = {
  schemaVersion: 1;
  taskId: string;
  executionId: string;
  scope: Omit<IssuedExecutionAuthorityMetadata['scope'], 'adopterId'>;
  runtimeSessionId: string;
  deadlineAt: string;
  authority: {
    metadata: IssuedExecutionAuthorityMetadata;
    executionAssertion: string;
    mcpCapability: string;
  };
};

export class HostedHeartbeatDelegationRejectedError extends Error {
  readonly name = 'HostedHeartbeatDelegationRejectedError';
}

type HostedHeartbeatDelegationPolicy = {
  tenantId: string;
  productSessionId: string;
  maxTurnMs: number;
  allowedTools: readonly string[];
};

/** Resolves one Heddle task back to current Lucid product authority. */
export class HostedHeartbeatDelegationService {
  readonly #policy: Readonly<HostedHeartbeatDelegationPolicy>;
  readonly #now: () => Date;

  constructor(
    private readonly authority: Pick<ExecutionAuthority, 'issue'>,
    private readonly store: Pick<
      AgentWakeStore,
      'readWorkspace' | 'listAgents' | 'listUsers'
    >,
    policy: HostedHeartbeatDelegationPolicy,
    options: { now?: () => Date } = {},
  ) {
    this.#policy = Object.freeze({
      ...policy,
      allowedTools: Object.freeze([...policy.allowedTools]),
    });
    this.#now = options.now ?? (() => new Date());
  }

  async issue(
    rawInput: HostedHeartbeatDelegationRequest,
    signal?: AbortSignal,
  ): Promise<HostedHeartbeatDelegation> {
    const input = HostedHeartbeatDelegationRequestSchema.parse(rawInput);
    signal?.throwIfAborted();
    const agentId = agentIdFromTask(input.taskId);
    if (!agentId) {
      throw new HostedHeartbeatDelegationRejectedError(
        'The heartbeat task is not owned by Lucid.',
      );
    }

    const [workspace, agents, users] = await Promise.all([
      this.store.readWorkspace(),
      this.store.listAgents(),
      this.store.listUsers(),
    ]);
    if (!workspace.backgroundChecksEnabled) {
      throw new HostedHeartbeatDelegationRejectedError(
        'Lucid background work is paused.',
      );
    }
    const agent = agents.find((candidate) => candidate.id === agentId);
    const user = agent
      ? users.find((candidate) => candidate.id === agent.userId)
      : undefined;
    if (!agent || !user || user.status !== 'active') {
      throw new HostedHeartbeatDelegationRejectedError(
        'The heartbeat task no longer has an active Lucid owner.',
      );
    }

    const scope = {
      tenantId: this.#policy.tenantId,
      subjectId: user.id,
      productSessionId: this.#policy.productSessionId,
    };
    const runtimeSessionId = createHostedRuntimeSessionId(scope);
    const deadlineAt = dayjs(this.#now())
      .add(this.#policy.maxTurnMs, 'millisecond')
      .toISOString();
    const issued = await this.authority.issue({
      scope,
      runtimeSessionId,
      invocationId: input.executionId,
      workflow: HEARTBEAT_TASK_WORKFLOW,
      mcp: { allowedTools: this.#policy.allowedTools },
    });
    signal?.throwIfAborted();
    const mcpCapability = issued.mcpCapability();
    if (!mcpCapability) {
      throw new Error('Lucid heartbeat delegation requires an MCP capability.');
    }

    return {
      schemaVersion: 1,
      taskId: input.taskId,
      executionId: input.executionId,
      scope,
      runtimeSessionId,
      deadlineAt,
      authority: {
        metadata: issued.metadata,
        executionAssertion: issued.executionAssertion(),
        mcpCapability,
      },
    };
  }
}
