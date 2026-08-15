import type { McpInvocationScope } from '@heddleagent/execution-host-client/mcp';
import type { DiscoveryWorkspaceSnapshot } from '../../lucid/discovery-types.js';

/** The first product capability is deliberately small and read-only. */
export const READ_WORKSPACE_SNAPSHOT_TOOL = 'read_workspace_snapshot';

/**
 * Stable raw MCP names which Lucid is willing to expose. A signed capability
 * may only select names from this list; model input can never expand it.
 */
export const LUCID_PRODUCT_MCP_TOOLS = Object.freeze([
  READ_WORKSPACE_SNAPSHOT_TOOL,
] as const);

export type LucidProductMcpToolName =
  typeof LUCID_PRODUCT_MCP_TOOLS[number];

/**
 * Model-facing workspace projection with explicit background-check gates.
 *
 * The product domain stores the operator gate on the workspace while the UI
 * view also exposes the user's task preference. Returning both legacy
 * fields made one healthy paused state look contradictory to the agent.
 */
export type HostedWorkspaceProjection = Omit<
  DiscoveryWorkspaceSnapshot,
  'workspace' | 'backgroundChecks'
> & {
  workspace: Omit<
    DiscoveryWorkspaceSnapshot['workspace'],
    'backgroundChecksEnabled'
  >;
  backgroundChecks: Omit<
    DiscoveryWorkspaceSnapshot['backgroundChecks'],
    'enabled' | 'dispatchEnabled'
  > & {
    userChecksEnabled: boolean;
    operatorDispatchEnabled: boolean;
  };
};

/**
 * Product-owned read port. Implementations must resolve the workspace from the
 * verified scope and must not accept identity as model-controlled tool input.
 */
export interface ScopedWorkspaceProjectionReader {
  readWorkspaceProjection(input: {
    scope: McpInvocationScope;
    signal: AbortSignal;
  }): Promise<DiscoveryWorkspaceSnapshot>;
}
