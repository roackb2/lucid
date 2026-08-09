import { describe, expect, it } from 'vitest';
import {
  AgentCoreInvocationSchema,
  AgentCoreRuntimeSessionIdSchema,
} from './types.js';

describe('runtime wire contracts', () => {
  it('accepts the versioned conversation-turn input', () => {
    expect(AgentCoreInvocationSchema.parse(validInvocation())).toMatchObject({
      schemaVersion: 1,
      kind: 'conversation-turn',
    });
  });

  it('rejects unknown input fields and path-like identity values', () => {
    expect(() => AgentCoreInvocationSchema.parse({ ...validInvocation(), unexpected: true })).toThrow();
    expect(() => AgentCoreInvocationSchema.parse({
      ...validInvocation(),
      scope: { ...validInvocation().scope, tenantId: '../other-tenant' },
    })).toThrow();
  });

  it('enforces AgentCore session identifier length', () => {
    expect(AgentCoreRuntimeSessionIdSchema.parse('s'.repeat(33))).toHaveLength(33);
    expect(() => AgentCoreRuntimeSessionIdSchema.parse('too-short')).toThrow();
  });
});

function validInvocation() {
  return {
    schemaVersion: 1 as const,
    kind: 'conversation-turn' as const,
    invocationId: 'invocation-001',
    scope: {
      adopterId: 'heddle-customer',
      tenantId: 'company-a',
      userId: 'user-a',
      conversationId: 'conversation-a',
    },
    prompt: 'Inspect the workspace.',
  };
}
