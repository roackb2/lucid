import { createHash, timingSafeEqual } from 'node:crypto';
import type { RuntimeConfig } from './config.js';

export class RuntimeAuthenticationError extends Error {
  readonly name = 'RuntimeAuthenticationError';
}

export function authenticateRuntimeRequest(input: {
  config: Pick<RuntimeConfig, 'mode' | 'localTokenSha256'>;
  providedToken?: string;
}): void {
  if (input.config.mode === 'agentcore') {
    return;
  }

  const expected = input.config.localTokenSha256;
  const provided = input.providedToken;
  if (!expected || !provided || !matchesDigest(expected, provided)) {
    throw new RuntimeAuthenticationError('Runtime request authentication failed.');
  }
}

function matchesDigest(expectedHex: string, provided: string): boolean {
  const expectedDigest = Buffer.from(expectedHex, 'hex');
  const providedDigest = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}
