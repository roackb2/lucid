import type {
  DiscoveryWorkspaceSnapshot,
} from '../../lucid/discovery-types.js';

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

/** Immutable authority derived only from a verified MCP capability. */
export type LucidMcpInvocationScope = {
  adopterId: string;
  tenantId: string;
  subjectId: string;
  productSessionId: string;
  runtimeSessionId: string;
  invocationId: string;
  workflow: 'conversation-turn';
};

export type VerifiedLucidMcpCapability = {
  capabilityId: string;
  serverId: string;
  allowedTools: readonly LucidProductMcpToolName[];
  scope: LucidMcpInvocationScope;
  issuedAt: string;
  expiresAt: string;
};

/** The HTTP boundary verifies the raw bearer on every stateless MCP request. */
export interface LucidMcpCapabilityVerifier {
  verify(assertion: string): Promise<VerifiedLucidMcpCapability>;
}

/**
 * Product-owned read port. Implementations must resolve the workspace from the
 * verified scope and must not accept identity as model-controlled tool input.
 */
export interface ScopedWorkspaceProjectionReader {
  readWorkspaceProjection(input: {
    scope: LucidMcpInvocationScope;
    signal: AbortSignal;
  }): Promise<DiscoveryWorkspaceSnapshot>;
}
