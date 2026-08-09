import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  RuntimeAuthenticationError,
  authenticateRuntimeRequest,
} from './request-auth.js';

describe('runtime request authentication', () => {
  it('requires the exact local token', () => {
    const token = 'a'.repeat(32);
    const config = {
      mode: 'local' as const,
      localTokenSha256: createHash('sha256').update(token).digest('hex'),
    };
    expect(() => authenticateRuntimeRequest({ config, providedToken: token })).not.toThrow();
    expect(() => authenticateRuntimeRequest({ config, providedToken: 'b'.repeat(32) }))
      .toThrow(RuntimeAuthenticationError);
  });

  it('delegates authentication to AgentCore SigV4 ingress in managed mode', () => {
    expect(() => authenticateRuntimeRequest({
      config: { mode: 'agentcore', localTokenSha256: undefined },
    })).not.toThrow();
  });
});
