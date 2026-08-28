import type { McpInvocationScope } from '@heddleagent/execution-host-client/mcp';
import type { AgentWorkService } from '../../lucid/agent/work-service.js';
import type {
  ScopedAgentWorkToolExecutor,
} from './types.js';

export type AgentWorkToolIdentity = Pick<
  McpInvocationScope,
  'tenantId' | 'productSessionId'
>;

export class AgentWorkToolScopeError extends Error {
  readonly name = 'AgentWorkToolScopeError';

  constructor() {
    super('The capability cannot access this Lucid agent work claim.');
  }
}

/** Resolves a signed heartbeat capability to its current Lucid work claim. */
export class CapabilityScopedAgentWorkToolExecutor
implements ScopedAgentWorkToolExecutor {
  constructor(
    private readonly identity: AgentWorkToolIdentity,
    private readonly work: Pick<AgentWorkService, 'executeTool'>,
  ) {}

  async executeAgentWorkTool(
    input: Parameters<ScopedAgentWorkToolExecutor['executeAgentWorkTool']>[0],
  ): Promise<unknown> {
    input.signal.throwIfAborted();
    this.#assertScope(input.scope);
    return await this.work.executeTool({
      userId: input.scope.subjectId,
      executionId: input.scope.invocationId,
      toolName: input.toolName,
      arguments: input.arguments,
      signal: input.signal,
    });
  }

  #assertScope(scope: McpInvocationScope): void {
    if (
      scope.tenantId !== this.identity.tenantId
      || scope.productSessionId !== this.identity.productSessionId
      || scope.workflow !== 'heartbeat-task'
    ) {
      throw new AgentWorkToolScopeError();
    }
  }
}
