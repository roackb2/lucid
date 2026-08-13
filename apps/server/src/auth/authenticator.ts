import { createHash, timingSafeEqual } from 'node:crypto';
import { LOCAL_USER_ID } from '../lucid/local-user.js';
import type {
  UserIdentityReader,
} from '../lucid/network/store.js';
import type { LucidRequestPrincipal } from './request-principal.js';
import {
  createSupabaseAuthenticator,
  type SupabaseAuthenticationConfig,
} from './supabase-authenticator.js';

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
      userToken: string;
      operatorToken: string;
    }
  | SupabaseAuthenticationConfig;

/**
 * Builds the request authenticator owned by the product HTTP boundary.
 *
 * Development identity is deliberately restricted to loopback. Static tokens
 * are a private-pilot adapter, not a multi-user identity provider.
 */
export function createLucidAuthenticator(
  config: LucidAuthenticationConfig,
  identities?: UserIdentityReader,
): LucidAuthenticator {
  if (config.mode === 'development') {
    return {
      authenticate: async ({ remoteAddress }) => (
        isLoopbackAddress(remoteAddress)
          ? {
              subject: 'development:local-user',
              userId: LOCAL_USER_ID,
              roles: ['user', 'operator'],
            }
          : undefined
      ),
    };
  }

  if (config.mode === 'supabase') {
    if (!identities) {
      throw new Error('Supabase authentication requires the Lucid identity reader.');
    }
    return createSupabaseAuthenticator(config, identities);
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
          userId: LOCAL_USER_ID,
          roles: ['user', 'operator'],
        };
      }
      if (tokensEqual(token, config.userToken)) {
        return {
          subject: 'static-token:user',
          userId: LOCAL_USER_ID,
          roles: ['user'],
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
