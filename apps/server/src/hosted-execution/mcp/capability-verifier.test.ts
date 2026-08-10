import { describe, expect, it } from 'vitest';
import {
  JwtLucidMcpCapabilityVerifier,
  LucidMcpCapabilityVerificationError,
} from './capability-verifier.js';
import {
  MCP_TEST_NOW_SECONDS,
  McpCapabilitySignerFixture,
} from './test-support.js';
import { READ_WORKSPACE_SNAPSHOT_TOOL } from './types.js';

describe('Lucid MCP capability verifier', () => {
  it('derives immutable invocation and tool scope from a valid signed capability', async () => {
    const signer = await McpCapabilitySignerFixture.create();
    const capability = await signer.verifier().verify(await signer.sign());

    expect(capability).toEqual({
      capabilityId: 'capability-001',
      serverId: 'lucid-product',
      allowedTools: [READ_WORKSPACE_SNAPSHOT_TOOL],
      scope: {
        adopterId: 'lucid-adopter',
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        productSessionId: 'product-session-a',
        runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
        invocationId: 'invocation-001',
        workflow: 'conversation-turn',
      },
      issuedAt: '2026-08-10T05:00:00.000Z',
      expiresAt: '2026-08-10T05:01:00.000Z',
    });
    expect(Object.isFrozen(capability.scope)).toBe(true);
    expect(Object.isFrozen(capability.allowedTools)).toBe(true);
  });

  it.each([
    ['untrusted adopter', { adopterId: 'another-adopter' }],
    ['wrong server', { serverId: 'another-server' }],
    ['unsupported tool', { allowedTools: ['delete_workspace'] }],
    ['duplicate tool', {
      allowedTools: [
        READ_WORKSPACE_SNAPSHOT_TOOL,
        READ_WORKSPACE_SNAPSHOT_TOOL,
      ],
    }],
    ['reused invocation id', {
      invocationId: 'same-id',
      capabilityId: 'same-id',
    }],
    ['overlong lifetime', {
      expiresAt: MCP_TEST_NOW_SECONDS + 301,
    }],
  ])('rejects %s without exposing claim detail', async (_label, overrides) => {
    const signer = await McpCapabilitySignerFixture.create();

    await expect(signer.verifier().verify(await signer.sign(overrides)))
      .rejects.toEqual(expect.objectContaining({
        name: 'LucidMcpCapabilityVerificationError',
        message: 'MCP capability verification failed.',
      }));
  });

  it('rejects a capability after its expiry', async () => {
    const signer = await McpCapabilitySignerFixture.create();
    const assertion = await signer.sign({ expiresAt: MCP_TEST_NOW_SECONDS + 10 });
    const verifier = signer.verifier(
      () => new Date((MCP_TEST_NOW_SECONDS + 13) * 1_000),
    );

    await expect(verifier.verify(assertion)).rejects.toBeInstanceOf(
      LucidMcpCapabilityVerificationError,
    );
  });

  it.each([
    ['plaintext remote issuer', { issuer: 'http://lucid.example.test' }],
    ['credential-bearing JWKS URL', {
      jwksUrl: new URL('https://user:secret@lucid.example.test/jwks'),
    }],
    ['JWKS URL query', {
      jwksUrl: new URL('https://lucid.example.test/jwks?token=secret'),
    }],
    ['unsupported algorithm', { jwtAlgorithms: ['HS256'] }],
    ['zero capability age', { maxCapabilityAgeSeconds: 0 }],
    ['excessive clock tolerance', { clockToleranceSeconds: 61 }],
  ])('rejects %s configuration', (_label, override) => {
    expect(() => new JwtLucidMcpCapabilityVerifier({
      issuer: 'https://lucid.example.test',
      audience: 'urn:lucid:mcp:test',
      jwksUrl: new URL('https://lucid.example.test/.well-known/jwks.json'),
      jwtAlgorithms: ['ES256'],
      trustedAdopterId: 'lucid-adopter',
      serverId: 'lucid-product',
      maxCapabilityAgeSeconds: 300,
      clockToleranceSeconds: 2,
      ...override,
    })).toThrow();
  });
});
