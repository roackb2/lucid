import {
  createRemoteJWKSet,
  customFetch,
  errors,
  jwtVerify,
  type FetchImplementation,
} from 'jose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { LOCAL_USER_ID } from '../lucid/local-user.js';
import type {
  UserIdentityReader,
} from '../lucid/network/store.js';
import type {
  LucidAuthenticationInput,
  LucidAuthenticator,
} from './authenticator.js';
import type {
  LucidExternalIdentity,
  LucidRequestPrincipal,
} from './request-principal.js';

const SUPABASE_AUDIENCE = 'authenticated';
const MAX_ACCESS_TOKEN_CHARACTERS = 8_192;

export type SupabaseAuthenticationConfig = {
  mode: 'supabase';
  projectUrl: string;
  operatorToken: string;
  allowSelfEnrollment: boolean;
};

/**
 * Verifies a Supabase session and resolves it to Lucid's durable user.
 * Provider profile claims stop at this boundary; authorization comes from the
 * product-owned identity binding, never email or Google metadata.
 */
export function createSupabaseAuthenticator(
  config: SupabaseAuthenticationConfig,
  identities: UserIdentityReader,
  options: { fetch?: FetchImplementation } = {},
): LucidAuthenticator {
  const projectUrl = parseProjectUrl(config.projectUrl);
  const issuer = new URL('/auth/v1', projectUrl).toString().replace(/\/$/, '');
  const jwks = createRemoteJWKSet(
    new URL('/auth/v1/.well-known/jwks.json', projectUrl),
    options.fetch ? { [customFetch]: options.fetch } : undefined,
  );

  return {
    authenticate: async (input) => {
      const token = readBearerToken(input);
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
      if (token.length > MAX_ACCESS_TOKEN_CHARACTERS) {
        return undefined;
      }

      const identity = await verifySupabaseIdentity(token, {
        issuer,
        jwks,
      });
      if (!identity) {
        return undefined;
      }
      const binding = await identities.resolveUserIdentity(identity);
      const activeUserId = binding?.status === 'active'
        ? binding.userId
        : undefined;
      return {
        subject: `${identity.issuer}:${identity.subject}`,
        externalIdentity: identity,
        userId: activeUserId,
        roles: activeUserId ? ['user'] : [],
      } satisfies LucidRequestPrincipal;
    },
  };
}

async function verifySupabaseIdentity(
  token: string,
  input: {
    issuer: string;
    jwks: ReturnType<typeof createRemoteJWKSet>;
  },
): Promise<LucidExternalIdentity | undefined> {
  try {
    const verified = await jwtVerify(token, input.jwks, {
      algorithms: ['ES256', 'RS256'],
      audience: SUPABASE_AUDIENCE,
      issuer: input.issuer,
    });
    if (
      !verified.payload.sub
      || verified.payload.role !== SUPABASE_AUDIENCE
      || verified.payload.is_anonymous === true
    ) {
      return undefined;
    }
    return { issuer: input.issuer, subject: verified.payload.sub };
  } catch (error) {
    if (error instanceof errors.JOSEError) {
      return undefined;
    }
    throw error;
  }
}

function parseProjectUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('Supabase authentication requires a credential-free HTTPS project URL.');
  }
  return url;
}

function readBearerToken(
  input: LucidAuthenticationInput,
): string | undefined {
  const match = /^Bearer ([^\s]+)$/i.exec(input.authorization?.trim() ?? '');
  return match?.[1];
}

function tokensEqual(received: string, expected: string): boolean {
  return timingSafeEqual(tokenDigest(received), tokenDigest(expected));
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
