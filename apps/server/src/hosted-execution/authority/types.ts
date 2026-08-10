import type { JSONWebKeySet } from 'jose';

export const EXECUTION_ASSERTION_TYPE = 'heddle-execution+jwt';
export const MCP_CAPABILITY_TYPE = 'heddle-mcp-capability+jwt';

export type HostedExecutionWorkflow = 'conversation-turn';

/** Product identity authorized by Lucid before hosted execution begins. */
export type HostedExecutionScope = {
  adopterId: string;
  tenantId: string;
  subjectId: string;
  productSessionId: string;
};

export type ExecutionAuthorityIssueInput = {
  scope: Omit<HostedExecutionScope, 'adopterId'>;
  runtimeSessionId: string;
  invocationId: string;
  workflow: HostedExecutionWorkflow;
  allowedTools: readonly string[];
};

export type ExecutionAuthorityConfig = {
  issuer: string;
  adopterId: string;
  executionAudience: string;
  mcpAudience: string;
  mcpServerId: string;
  keyId: string;
  executionTtlSeconds: number;
  mcpTtlSeconds: number;
};

export type IssuedExecutionAuthorityMetadata = {
  scope: HostedExecutionScope;
  runtimeSessionId: string;
  invocationId: string;
  capabilityId: string;
  workflow: HostedExecutionWorkflow;
  allowedTools: readonly string[];
  issuedAt: string;
  executionExpiresAt: string;
  mcpExpiresAt: string;
};

/**
 * Short-lived credentials are readable only through explicit accessors. Class
 * serialization contains credential-free metadata, not JWTs. The identifiers
 * can still be sensitive product data and require normal logging minimization.
 */
export interface IssuedExecutionAuthority {
  readonly metadata: IssuedExecutionAuthorityMetadata;
  executionAssertion(): string;
  mcpCapability(): string;
  toJSON(): IssuedExecutionAuthorityMetadata;
}

/** Lucid-owned port for minting one invocation's hosted authority. */
export interface ExecutionAuthority {
  issue(input: ExecutionAuthorityIssueInput): Promise<IssuedExecutionAuthority>;
  publicJwks(): JSONWebKeySet;
}
