import { webcrypto } from 'node:crypto';
import {
  JoseExecutionAuthority,
  type ExecutionAuthority,
} from '@heddleagent/execution-host-client/authority';
import {
  JwtMcpCapabilityVerifier,
} from '@heddleagent/execution-host-client/mcp';
import type {
  DiscoveryWorkspaceSnapshot,
} from '../../lucid/discovery-types.js';
import {
  LUCID_PRODUCT_MCP_TOOLS,
  READ_WORKSPACE_SNAPSHOT_TOOL,
  type LucidProductMcpToolName,
} from './types.js';

export const MCP_TEST_NOW = new Date('2026-08-10T05:00:00.000Z');

export type CapabilityClaimOverrides = {
  tenantId?: string;
  subjectId?: string;
  productSessionId?: string;
  runtimeSessionId?: string;
  invocationId?: string;
  allowedTools?: readonly string[];
};

/**
 * Exercises Lucid's product MCP edge with the same released authority and
 * verification services that production composition will consume.
 */
export class McpCapabilitySignerFixture {
  private constructor(
    readonly authority: ExecutionAuthority,
    private readonly publicKey: webcrypto.CryptoKey,
  ) {}

  static async create(): Promise<McpCapabilitySignerFixture> {
    const keyPair = await webcrypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    ) as webcrypto.CryptoKeyPair;
    let capabilitySequence = 0;
    const authority = await JoseExecutionAuthority.create({
      issuer: 'https://lucid.example.test',
      adopterId: 'lucid-adopter',
      executionAudience: 'urn:lucid:execution:test',
      keyId: 'lucid-mcp-test-key',
      executionTtlSeconds: 60,
      mcp: {
        audience: 'urn:lucid:mcp:test',
        serverId: 'lucid-product',
        ttlSeconds: 60,
      },
    }, keyPair, {
      now: () => MCP_TEST_NOW,
      createCapabilityId: () => `capability-${++capabilitySequence}`,
    });
    return new McpCapabilitySignerFixture(authority, keyPair.publicKey);
  }

  async sign(overrides: CapabilityClaimOverrides = {}): Promise<string> {
    const issued = await this.authority.issue({
      scope: {
        tenantId: overrides.tenantId ?? 'tenant-a',
        subjectId: overrides.subjectId ?? 'subject-a',
        productSessionId:
          overrides.productSessionId ?? 'product-session-a',
      },
      runtimeSessionId: overrides.runtimeSessionId
        ?? `runtime-session:${'a'.repeat(40)}`,
      invocationId: overrides.invocationId ?? 'invocation-001',
      workflow: 'conversation-turn',
      mcp: {
        allowedTools: overrides.allowedTools
          ?? [READ_WORKSPACE_SNAPSHOT_TOOL],
      },
    });
    const capability = issued.mcpCapability();
    if (!capability) {
      throw new Error('The MCP test authority did not issue a capability.');
    }
    return capability;
  }

  verifier(now: () => Date = () => MCP_TEST_NOW) {
    return new JwtMcpCapabilityVerifier<LucidProductMcpToolName>({
      issuer: 'https://lucid.example.test',
      audience: 'urn:lucid:mcp:test',
      jwksUrl: new URL('https://lucid.example.test/.well-known/jwks.json'),
      trustedAdopterId: 'lucid-adopter',
      serverId: 'lucid-product',
      supportedTools: LUCID_PRODUCT_MCP_TOOLS,
      maxCapabilityAgeSeconds: 300,
      clockToleranceSeconds: 2,
    }, {
      keyResolver: async () => this.publicKey,
      now,
    });
  }
}

export function workspaceSnapshot(): DiscoveryWorkspaceSnapshot {
  const user = {
    id: 'local-user',
    workspaceId: 'local-discovery-workspace',
    kind: 'human' as const,
    status: 'active' as const,
    displayName: 'You',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
  return {
    workspace: {
      id: 'local-discovery-workspace',
      versionId: 'workspace-version-001',
      currentWake: 1,
      backgroundChecksEnabled: true,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    user: user,
    agent: {
      id: 'user-agent',
      workspaceId: 'local-discovery-workspace',
      userId: 'local-user',
      sortOrder: 0,
      name: 'Lucid',
      role: 'Your agent',
      color: '#176b5b',
      purpose: 'Represent the user.',
      status: 'idle',
      runCount: 1,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      user,
      unreadCount: 0,
      isCurrentUserAgent: true,
    },
    findings: [],
    agentActivity: [],
    backgroundChecks: {
      enabled: true,
      dispatchEnabled: true,
      running: false,
      intervalMs: 60_000,
      tasks: [],
    },
    runtime: {
      model: 'test-model',
      heddleVersion: '5.13.0',
    },
  };
}
