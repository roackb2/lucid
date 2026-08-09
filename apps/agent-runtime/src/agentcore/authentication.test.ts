import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AgentCoreAuthenticationError,
  authenticateAgentCoreRequest,
} from './authentication.js';

describe('runtime request authentication', () => {
  it('requires the exact local token', () => {
    const token = 'a'.repeat(32);
    const config = {
      mode: 'local' as const,
      localTokenSha256: createHash('sha256').update(token).digest('hex'),
    };
    expect(() => authenticateAgentCoreRequest({ config, providedToken: token })).not.toThrow();
    expect(() => authenticateAgentCoreRequest({ config, providedToken: 'b'.repeat(32) }))
      .toThrow(AgentCoreAuthenticationError);
  });

  it('delegates authentication to AgentCore SigV4 ingress in managed mode', () => {
    expect(() => authenticateAgentCoreRequest({
      config: { mode: 'agentcore', localTokenSha256: undefined },
    })).not.toThrow();
  });
});
