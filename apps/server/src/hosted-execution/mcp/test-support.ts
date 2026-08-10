import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
} from 'jose';
import type {
  DiscoveryWorkspaceSnapshot,
} from '../../lucid/discovery-types.js';
import {
  HEDDLE_MCP_CAPABILITY_TYPE,
  JwtLucidMcpCapabilityVerifier,
} from './capability-verifier.js';
import { READ_WORKSPACE_SNAPSHOT_TOOL } from './types.js';

export const MCP_TEST_NOW = new Date('2026-08-10T05:00:00.000Z');
export const MCP_TEST_NOW_SECONDS = Math.floor(MCP_TEST_NOW.getTime() / 1_000);

export type CapabilityClaimOverrides = {
  adopterId?: string;
  tenantId?: string;
  subjectId?: string;
  productSessionId?: string;
  runtimeSessionId?: string;
  invocationId?: string;
  capabilityId?: string;
  serverId?: string;
  allowedTools?: string[];
  contractVersion?: number;
  workflow?: string;
  issuedAt?: number;
  expiresAt?: number;
};

export class McpCapabilitySignerFixture {
  private constructor(
    readonly jwks: JSONWebKeySet,
    private readonly privateKey: Awaited<
      ReturnType<typeof generateKeyPair>
    >['privateKey'],
  ) {}

  static async create(): Promise<McpCapabilitySignerFixture> {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const publicJwk = await exportJWK(publicKey);
    return new McpCapabilitySignerFixture(
      { keys: [{ ...publicJwk, alg: 'ES256', kid: 'lucid-mcp-test-key' }] },
      privateKey,
    );
  }

  async sign(overrides: CapabilityClaimOverrides = {}): Promise<string> {
    const issuedAt = overrides.issuedAt ?? MCP_TEST_NOW_SECONDS;
    return await new SignJWT({
      contractVersion: overrides.contractVersion ?? 1,
      adopterId: overrides.adopterId ?? 'lucid-adopter',
      tenantId: overrides.tenantId ?? 'tenant-a',
      productSessionId: overrides.productSessionId ?? 'product-session-a',
      runtimeSessionId: overrides.runtimeSessionId
        ?? `runtime-session:${'a'.repeat(40)}`,
      invocationId: overrides.invocationId ?? 'invocation-001',
      workflow: overrides.workflow ?? 'conversation-turn',
      serverId: overrides.serverId ?? 'lucid-product',
      allowedTools: overrides.allowedTools ?? [READ_WORKSPACE_SNAPSHOT_TOOL],
    })
      .setProtectedHeader({
        alg: 'ES256',
        kid: 'lucid-mcp-test-key',
        typ: HEDDLE_MCP_CAPABILITY_TYPE,
      })
      .setIssuer('https://lucid.example.test')
      .setAudience('urn:lucid:mcp:test')
      .setSubject(overrides.subjectId ?? 'subject-a')
      .setJti(overrides.capabilityId ?? 'capability-001')
      .setIssuedAt(issuedAt)
      .setExpirationTime(overrides.expiresAt ?? issuedAt + 60)
      .sign(this.privateKey);
  }

  verifier(now: () => Date = () => MCP_TEST_NOW) {
    return new JwtLucidMcpCapabilityVerifier({
      issuer: 'https://lucid.example.test',
      audience: 'urn:lucid:mcp:test',
      jwksUrl: new URL('https://lucid.example.test/.well-known/jwks.json'),
      jwtAlgorithms: ['ES256'],
      trustedAdopterId: 'lucid-adopter',
      serverId: 'lucid-product',
      maxCapabilityAgeSeconds: 300,
      clockToleranceSeconds: 2,
    }, {
      keyResolver: createLocalJWKSet(this.jwks),
      now,
    });
  }
}

export function workspaceSnapshot(): DiscoveryWorkspaceSnapshot {
  const participant = {
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
    user: participant,
    representative: {
      id: 'user-agent',
      workspaceId: 'local-discovery-workspace',
      participantId: 'local-user',
      sortOrder: 0,
      name: 'Lucid',
      role: 'Your representative',
      color: '#176b5b',
      purpose: 'Represent the participant.',
      status: 'idle',
      runCount: 1,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      participant,
      unreadCount: 0,
      isUserAgent: true,
    },
    findings: [],
    backgroundChecks: {
      enabled: true,
      dispatchEnabled: true,
      running: false,
      intervalMs: 60_000,
      tasks: [],
    },
    runtime: {
      model: 'test-model',
      heddleVersion: '5.10.0',
    },
  };
}
