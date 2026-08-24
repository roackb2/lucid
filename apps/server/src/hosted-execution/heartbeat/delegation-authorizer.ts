import type {
  HostedHeartbeatDelegationAuthorization,
  HostedHeartbeatDelegationAuthorizationInput,
  HostedHeartbeatDelegationAuthorizer,
} from '@heddleagent/execution-host-client/coordinator';
import { agentIdFromTask } from '../../lucid/agent/heartbeat-task-identity.js';
import type { AgentWakeStore } from '../../lucid/agent/store.js';

type LucidHeartbeatDelegationPolicy = {
  tenantId: string;
  productSessionId: string;
  allowedTools: readonly string[];
};

/** Resolves one claimed Heddle task against current Lucid identity and policy. */
export class LucidHeartbeatDelegationAuthorizer
implements HostedHeartbeatDelegationAuthorizer {
  readonly #policy: Readonly<LucidHeartbeatDelegationPolicy>;

  constructor(
    private readonly store: Pick<
      AgentWakeStore,
      'readWorkspace' | 'listAgents' | 'listUsers'
    >,
    policy: LucidHeartbeatDelegationPolicy,
  ) {
    this.#policy = Object.freeze({
      ...policy,
      allowedTools: Object.freeze([...policy.allowedTools]),
    });
  }

  async authorize(
    input: HostedHeartbeatDelegationAuthorizationInput,
  ): Promise<HostedHeartbeatDelegationAuthorization | undefined> {
    input.signal.throwIfAborted();
    const agentId = agentIdFromTask(input.taskId);
    if (!agentId) {
      return undefined;
    }

    const [workspace, agents, users] = await Promise.all([
      this.store.readWorkspace(),
      this.store.listAgents(),
      this.store.listUsers(),
    ]);
    if (!workspace.backgroundChecksEnabled) {
      return undefined;
    }

    const agent = agents.find((candidate) => candidate.id === agentId);
    const user = agent
      ? users.find((candidate) => candidate.id === agent.userId)
      : undefined;
    if (!user || user.status !== 'active') {
      return undefined;
    }

    return {
      scope: {
        tenantId: this.#policy.tenantId,
        subjectId: user.id,
        productSessionId: this.#policy.productSessionId,
      },
      allowedTools: [...this.#policy.allowedTools],
    };
  }
}
