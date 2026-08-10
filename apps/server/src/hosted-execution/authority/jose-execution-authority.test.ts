import {
  createLocalJWKSet,
  decodeProtectedHeader,
  generateKeyPair,
  jwtVerify,
  type CryptoKey,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  JwtLucidMcpCapabilityVerifier,
} from '../mcp/capability-verifier.js';
import { READ_WORKSPACE_SNAPSHOT_TOOL } from '../mcp/types.js';
import { JoseExecutionAuthority } from './jose-execution-authority.js';
import {
  EXECUTION_ASSERTION_TYPE,
  MCP_CAPABILITY_TYPE,
  type ExecutionAuthorityConfig,
  type ExecutionAuthorityIssueInput,
} from './types.js';

const NOW = new Date('2026-08-10T04:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);
const KEY_ID = 'lucid-hosted-execution-2026-08';

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

describe('JOSE hosted execution authority', () => {
  it('mints separately typed and scoped v1 execution and MCP authority', async () => {
    const authority = await createAuthority();
    const issued = await authority.issue(issueInput());
    const keyResolver = createLocalJWKSet(authority.publicJwks());

    const execution = await jwtVerify(
      issued.executionAssertion(),
      keyResolver,
      {
        algorithms: ['ES256'],
        audience: 'urn:heddle-execution-host:lucid',
        issuer: 'https://lucid.example.test',
        typ: EXECUTION_ASSERTION_TYPE,
        currentDate: NOW,
      },
    );
    const capability = await jwtVerify(
      issued.mcpCapability(),
      keyResolver,
      {
        algorithms: ['ES256'],
        audience: 'urn:lucid-mcp:hosted-execution',
        issuer: 'https://lucid.example.test',
        typ: MCP_CAPABILITY_TYPE,
        currentDate: NOW,
      },
    );

    expect(execution.payload).toMatchObject({
      contractVersion: 1,
      adopterId: 'lucid',
      tenantId: 'company-a',
      productSessionId: 'conversation-a',
      runtimeSessionId: runtimeSessionId(),
      workflow: 'conversation-turn',
      sub: 'participant-a',
      jti: 'invocation-001',
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 300,
    });
    expect(capability.payload).toMatchObject({
      contractVersion: 1,
      adopterId: 'lucid',
      tenantId: 'company-a',
      productSessionId: 'conversation-a',
      runtimeSessionId: runtimeSessionId(),
      invocationId: 'invocation-001',
      workflow: 'conversation-turn',
      serverId: 'lucid_product',
      allowedTools: [READ_WORKSPACE_SNAPSHOT_TOOL],
      sub: 'participant-a',
      jti: 'capability-001',
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 600,
    });
    expect(decodeProtectedHeader(issued.executionAssertion())).toEqual({
      alg: 'ES256',
      kid: KEY_ID,
      typ: EXECUTION_ASSERTION_TYPE,
    });
    expect(decodeProtectedHeader(issued.mcpCapability())).toEqual({
      alg: 'ES256',
      kid: KEY_ID,
      typ: MCP_CAPABILITY_TYPE,
    });
  });

  it('produces an MCP capability accepted by Lucid independent verification', async () => {
    const authority = await createAuthority();
    const issued = await authority.issue(issueInput());
    const verifier = new JwtLucidMcpCapabilityVerifier({
      issuer: 'https://lucid.example.test',
      audience: 'urn:lucid-mcp:hosted-execution',
      jwksUrl: new URL('https://lucid.example.test/.well-known/jwks.json'),
      jwtAlgorithms: ['ES256'],
      trustedAdopterId: 'lucid',
      serverId: 'lucid_product',
      maxCapabilityAgeSeconds: 15 * 60,
      clockToleranceSeconds: 2,
    }, {
      keyResolver: createLocalJWKSet(authority.publicJwks()),
      now: () => NOW,
    });

    await expect(verifier.verify(issued.mcpCapability())).resolves.toEqual({
      capabilityId: 'capability-001',
      serverId: 'lucid_product',
      allowedTools: [READ_WORKSPACE_SNAPSHOT_TOOL],
      scope: {
        adopterId: 'lucid',
        tenantId: 'company-a',
        subjectId: 'participant-a',
        productSessionId: 'conversation-a',
        runtimeSessionId: runtimeSessionId(),
        invocationId: 'invocation-001',
        workflow: 'conversation-turn',
      },
      issuedAt: NOW.toISOString(),
      expiresAt: new Date((NOW_SECONDS + 600) * 1_000).toISOString(),
    });
  });

  it('publishes only a defensive public verification projection', async () => {
    const authority = await createAuthority();
    const first = authority.publicJwks();
    first.keys[0]!.kid = 'caller-mutated';
    const second = authority.publicJwks();

    expect(second).toEqual({
      keys: [{
        kty: 'EC',
        crv: 'P-256',
        x: expect.any(String),
        y: expect.any(String),
        alg: 'ES256',
        kid: KEY_ID,
        use: 'sig',
      }],
    });
    expect(JSON.stringify(second)).not.toContain('"d"');
  });

  it('keeps compact credentials out of ordinary serialized results', async () => {
    const authority = await createAuthority();
    const issued = await authority.issue(issueInput());
    const serialized = JSON.stringify(issued);

    expect(serialized).toContain('"invocationId":"invocation-001"');
    expect(serialized).not.toContain(issued.executionAssertion());
    expect(serialized).not.toContain(issued.mcpCapability());
    expect(Object.keys(issued)).toEqual(['metadata']);
  });

  it.each([
    ['caller-selected path identity', { invocationId: '../other-invocation' }],
    ['short Runtime session identity', { runtimeSessionId: 'too-short' }],
    ['punctuated MCP tool alias', { allowedTools: ['read.scope'] }],
    ['duplicate MCP tool aliases', { allowedTools: ['read_scope', 'read_scope'] }],
  ])('rejects %s before signing', async (_label, override) => {
    const authority = await createAuthority();
    await expect(authority.issue({
      ...issueInput(),
      ...override,
    })).rejects.toThrow();
  });

  it('requires separate credential audiences and identities', async () => {
    await expect(createAuthority({
      mcpAudience: 'urn:heddle-execution-host:lucid',
    })).rejects.toThrow(/distinct/);

    const authority = await createAuthority({}, () => 'invocation-001');
    await expect(authority.issue(issueInput()))
      .rejects.toThrow(/distinct/);
  });

  it('keeps adopter identity in deployment policy instead of issuance input', async () => {
    const authority = await createAuthority();
    const callerSelectedAdopter = {
      ...issueInput(),
      scope: { ...issueInput().scope, adopterId: 'other-adopter' },
    } as unknown as ExecutionAuthorityIssueInput;

    await expect(authority.issue(callerSelectedAdopter)).rejects.toThrow();
  });

  it('rejects a public key that does not match the private signing key', async () => {
    const otherPair = await generateKeyPair('ES256');
    await expect(JoseExecutionAuthority.create(
      config(),
      { privateKey, publicKey: otherPair.publicKey },
    )).rejects.toThrow(/do not match/);
  });

  it.each([
    ['plaintext remote issuer', { issuer: 'http://lucid.example.test' }],
    ['credential-bearing issuer', { issuer: 'https://user:secret@lucid.example.test' }],
    ['issuer query', { issuer: 'https://lucid.example.test?token=secret' }],
    ['overlong MCP lifetime', { mcpTtlSeconds: 15 * 60 + 1 }],
  ])('rejects %s configuration', async (_label, override) => {
    await expect(createAuthority(override)).rejects.toThrow();
  });
});

function createAuthority(
  overrides: Partial<ExecutionAuthorityConfig> = {},
  createCapabilityId: () => string = () => 'capability-001',
): Promise<JoseExecutionAuthority> {
  return JoseExecutionAuthority.create(
    config(overrides),
    { privateKey, publicKey },
    { now: () => NOW, createCapabilityId },
  );
}

function config(
  overrides: Partial<ExecutionAuthorityConfig> = {},
): ExecutionAuthorityConfig {
  return {
    issuer: 'https://lucid.example.test',
    adopterId: 'lucid',
    executionAudience: 'urn:heddle-execution-host:lucid',
    mcpAudience: 'urn:lucid-mcp:hosted-execution',
    mcpServerId: 'lucid_product',
    keyId: KEY_ID,
    executionTtlSeconds: 300,
    mcpTtlSeconds: 600,
    ...overrides,
  };
}

function issueInput(): ExecutionAuthorityIssueInput {
  return {
    scope: {
      tenantId: 'company-a',
      subjectId: 'participant-a',
      productSessionId: 'conversation-a',
    },
    runtimeSessionId: runtimeSessionId(),
    invocationId: 'invocation-001',
    workflow: 'conversation-turn',
    allowedTools: [READ_WORKSPACE_SNAPSHOT_TOOL],
  };
}

function runtimeSessionId(): string {
  return 'runtime-session-'.padEnd(33, 's');
}
