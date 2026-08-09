import { createHash, timingSafeEqual } from 'node:crypto';
import type { AgentCoreHttpConfig } from './types.js';

export class AgentCoreAuthenticationError extends Error {
  readonly name = 'AgentCoreAuthenticationError';
}

export function authenticateAgentCoreRequest(input: {
  config: Pick<AgentCoreHttpConfig, 'mode' | 'localTokenSha256'>;
  providedToken?: string;
}): void {
  if (input.config.mode === 'agentcore') {
    return;
  }

  const expected = input.config.localTokenSha256;
  const provided = input.providedToken;
  if (!expected || !provided || !matchesDigest(expected, provided)) {
    throw new AgentCoreAuthenticationError('Runtime request authentication failed.');
  }
}

function matchesDigest(expectedHex: string, provided: string): boolean {
  const expectedDigest = Buffer.from(expectedHex, 'hex');
  const providedDigest = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}
