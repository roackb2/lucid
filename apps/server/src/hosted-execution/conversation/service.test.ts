import { webcrypto } from 'node:crypto';
import {
  JoseExecutionAuthority,
} from '@roackb2/heddle-adopter/authority';
import type {
  ExecutionHost,
  ExecutionHostConversationTurn,
} from '@roackb2/heddle-adopter/http-sse';
import { describe, expect, it, vi } from 'vitest';
import { LUCID_PRODUCT_MCP_TOOLS } from '../mcp/types.js';
import {
  HostedConversationTurnService,
} from './service.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');

describe('HostedConversationTurnService', () => {
  it('fixes Lucid tool policy and delegates one ordered host stream', async () => {
    const authority = await createAuthority(true);
    const issue = vi.spyOn(authority, 'issue');
    const observedTurns: ExecutionHostConversationTurn[] = [];
    const executionHost: ExecutionHost = {
      async *streamConversationTurn(input) {
        observedTurns.push(input);
        yield {
          schemaVersion: 1,
          invocationId: input.invocationId,
          runId: 'run-001',
          sequence: 0,
          timestamp: NOW.toISOString(),
          kind: 'accepted',
        };
        yield {
          schemaVersion: 1,
          invocationId: input.invocationId,
          runId: 'run-001',
          sequence: 1,
          timestamp: NOW.toISOString(),
          kind: 'result',
          result: { outcome: 'done', summary: 'complete' },
        };
      },
    };
    const credentials = {
      resolveModelApiKey: vi.fn(async () => 'model-key-local-test'),
    };
    const service = new HostedConversationTurnService(
      authority,
      executionHost,
      credentials,
    );

    const events = [];
    for await (const event of service.streamTurn(turnInput())) {
      events.push(event);
    }

    expect(events.map(({ kind }) => kind)).toEqual(['accepted', 'result']);
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({
      workflow: 'conversation-turn',
      mcp: { allowedTools: LUCID_PRODUCT_MCP_TOOLS },
    }));
    expect(credentials.resolveModelApiKey).toHaveBeenCalledWith({
      scope: turnInput().scope,
      invocationId: 'invocation-001',
      signal: undefined,
    });
    expect(observedTurns).toHaveLength(1);
    expect(observedTurns[0]).toMatchObject({
      invocationId: 'invocation-001',
      runtimeSessionId: turnInput().runtimeSessionId,
      prompt: 'Summarize my Lucid workspace.',
      modelApiKey: 'model-key-local-test',
    });
    expect(observedTurns[0]?.executionAssertion).toEqual(expect.any(String));
    expect(observedTurns[0]?.executionAssertion.length).toBeGreaterThan(32);
    expect(observedTurns[0]?.mcpCapability).toEqual(expect.any(String));
    expect(observedTurns[0]?.mcpCapability?.length).toBeGreaterThan(32);
  });

  it('fails before model or host access when MCP authority is absent', async () => {
    const authority = await createAuthority(false);
    const executionHost = {
      streamConversationTurn: vi.fn(),
    } as unknown as ExecutionHost;
    const credentials = {
      resolveModelApiKey: vi.fn(async () => 'model-key-local-test'),
    };
    const service = new HostedConversationTurnService(
      authority,
      executionHost,
      credentials,
    );

    await expect(collect(service.streamTurn(turnInput()))).rejects.toThrow(
      'Execution authority cannot issue an MCP capability',
    );
    expect(credentials.resolveModelApiKey).not.toHaveBeenCalled();
    expect(executionHost.streamConversationTurn).not.toHaveBeenCalled();
  });
});

async function createAuthority(withMcp: boolean) {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as webcrypto.CryptoKeyPair;
  return await JoseExecutionAuthority.create({
    issuer: 'https://lucid.example.test',
    adopterId: 'lucid-adopter',
    executionAudience: 'urn:lucid:execution:test',
    keyId: 'lucid-hosted-conversation-test',
    executionTtlSeconds: 60,
    ...(withMcp ? {
      mcp: {
        audience: 'urn:lucid:mcp:test',
        serverId: 'lucid-product',
        ttlSeconds: 60,
      },
    } : {}),
  }, keyPair, { now: () => NOW });
}

function turnInput() {
  return {
    scope: {
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      productSessionId: 'product-session-a',
    },
    runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
    invocationId: 'invocation-001',
    prompt: 'Summarize my Lucid workspace.',
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
