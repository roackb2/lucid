import { createHash, timingSafeEqual } from 'node:crypto';
import { LOCAL_USER_ID } from '../lucid/local-participant.js';
import type { LucidRequestPrincipal } from './request-principal.js';

export type LucidAuthenticationInput = {
  authorization?: string;
  remoteAddress?: string;
};

export interface LucidAuthenticator {
  authenticate(
    input: LucidAuthenticationInput,
  ): Promise<LucidRequestPrincipal | undefined>;
}

export type LucidAuthenticationConfig =
  | { mode: 'development' }
  | {
      mode: 'static-token';
      participantToken: string;
      operatorToken: string;
    };

/**
 * Builds the request authenticator owned by the product HTTP boundary.
 *
 * Development identity is deliberately restricted to loopback. Static tokens
 * are a private-pilot adapter, not a multi-user identity provider.
 */
export function createLucidAuthenticator(
  config: LucidAuthenticationConfig,
): LucidAuthenticator {
  if (config.mode === 'development') {
    return {
      authenticate: async ({ remoteAddress }) => (
        isLoopbackAddress(remoteAddress)
          ? {
              subject: 'development:local-user',
              participantId: LOCAL_USER_ID,
              roles: ['participant', 'operator'],
            }
          : undefined
      ),
    };
  }

  return {
    authenticate: async ({ authorization }) => {
      const token = readBearerToken(authorization);
      if (!token) {
        return undefined;
      }
      if (tokensEqual(token, config.operatorToken)) {
        return {
          subject: 'static-token:operator',
          participantId: LOCAL_USER_ID,
          roles: ['participant', 'operator'],
        };
      }
      if (tokensEqual(token, config.participantToken)) {
        return {
          subject: 'static-token:participant',
          participantId: LOCAL_USER_ID,
          roles: ['participant'],
        };
      }
      return undefined;
    },
  };
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(authorization.trim());
  return match?.[1];
}

function tokensEqual(received: string, expected: string): boolean {
  return timingSafeEqual(tokenDigest(received), tokenDigest(expected));
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
