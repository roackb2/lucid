import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { z } from 'zod';
import {
  LUCID_PRODUCT_MCP_TOOLS,
  type LucidMcpCapabilityVerifier,
  type LucidProductMcpToolName,
  type VerifiedLucidMcpCapability,
} from './types.js';
import { MCP_CAPABILITY_TYPE } from '../authority/types.js';

export const HEDDLE_MCP_CAPABILITY_TYPE = MCP_CAPABILITY_TYPE;

const OpaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/,
    'must be an opaque, path-free identifier',
  );
const ServerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be a Heddle-compatible server identifier');
const ToolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'must be a collision-free tool name');
const knownTools = new Set<string>(LUCID_PRODUCT_MCP_TOOLS);
const AllowedToolsSchema = z
  .array(ToolNameSchema)
  .min(1)
  .max(LUCID_PRODUCT_MCP_TOOLS.length)
  .refine((tools) => new Set(tools).size === tools.length, {
    message: 'must contain unique tool names',
  })
  .refine((tools) => tools.every((tool) => knownTools.has(tool)), {
    message: 'contains an unsupported Lucid tool',
  })
  .transform((tools) => tools as LucidProductMcpToolName[]);

const CapabilityClaimsSchema = z.object({
  contractVersion: z.literal(1),
  adopterId: OpaqueIdSchema,
  tenantId: OpaqueIdSchema,
  productSessionId: OpaqueIdSchema,
  runtimeSessionId: z.string().trim().min(33).max(256),
  invocationId: OpaqueIdSchema,
  workflow: z.literal('conversation-turn'),
  serverId: ServerIdSchema,
  allowedTools: AllowedToolsSchema,
  sub: OpaqueIdSchema,
  jti: OpaqueIdSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export type JwtLucidMcpCapabilityConfig = {
  issuer: string;
  audience: string;
  jwksUrl: URL;
  jwtAlgorithms: string[];
  trustedAdopterId: string;
  serverId: string;
  maxCapabilityAgeSeconds: number;
  clockToleranceSeconds: number;
};

const JwtLucidMcpCapabilityConfigSchema = z.object({
  issuer: z.url().refine(
    (value) => isSafeWebUrl(new URL(value)),
    'must use HTTPS or loopback HTTP and contain no credentials, query, or fragment',
  ),
  audience: z.string().trim().min(1).max(512),
  jwksUrl: z.instanceof(URL).refine(
    isSafeWebUrl,
    'must use HTTPS or loopback HTTP and contain no credentials, query, or fragment',
  ),
  jwtAlgorithms: z.array(z.literal('ES256')).length(1),
  trustedAdopterId: OpaqueIdSchema,
  serverId: ServerIdSchema,
  maxCapabilityAgeSeconds: z.number().int().min(1).max(15 * 60),
  clockToleranceSeconds: z.number().int().min(0).max(60),
}).strict();

export class LucidMcpCapabilityVerificationError extends Error {
  readonly name = 'LucidMcpCapabilityVerificationError';

  constructor(options?: ErrorOptions) {
    super('MCP capability verification failed.', options);
  }
}

export class LucidMcpCapabilityUnavailableError extends Error {
  readonly name = 'LucidMcpCapabilityUnavailableError';

  constructor(options?: ErrorOptions) {
    super('MCP capability verification is temporarily unavailable.', options);
  }
}

/**
 * Independently verifies the adopter-signed capability at Lucid's MCP edge.
 * The Execution Host's earlier verification is defense in depth, not trust
 * forwarded to this service.
 */
export class JwtLucidMcpCapabilityVerifier
implements LucidMcpCapabilityVerifier {
  readonly #config: JwtLucidMcpCapabilityConfig;
  private readonly keyResolver: JWTVerifyGetKey;
  private readonly now: () => Date;

  constructor(
    config: JwtLucidMcpCapabilityConfig,
    options: {
      keyResolver?: JWTVerifyGetKey;
      now?: () => Date;
    } = {},
  ) {
    const parsed = JwtLucidMcpCapabilityConfigSchema.parse(config);
    this.#config = Object.freeze({
      ...parsed,
      jwksUrl: new URL(parsed.jwksUrl),
      jwtAlgorithms: [...parsed.jwtAlgorithms],
    });
    this.keyResolver = options.keyResolver ?? createRemoteJWKSet(
      this.#config.jwksUrl,
      {
        cacheMaxAge: 10 * 60_000,
        cooldownDuration: 30_000,
        timeoutDuration: 3_000,
      },
    );
    this.now = options.now ?? (() => new Date());
  }

  async verify(assertion: string): Promise<VerifiedLucidMcpCapability> {
    try {
      const { payload } = await jwtVerify(assertion, this.keyResolver, {
        algorithms: this.#config.jwtAlgorithms,
        audience: this.#config.audience,
        clockTolerance: this.#config.clockToleranceSeconds,
        currentDate: this.now(),
        issuer: this.#config.issuer,
        maxTokenAge: this.#config.maxCapabilityAgeSeconds,
        requiredClaims: ['exp', 'iat', 'jti', 'sub'],
        typ: HEDDLE_MCP_CAPABILITY_TYPE,
      });
      const claims = CapabilityClaimsSchema.parse(payload);
      this.assertDeploymentBinding(claims);
      this.assertBoundedLifetime(claims);

      return {
        capabilityId: claims.jti,
        serverId: claims.serverId,
        allowedTools: Object.freeze([...claims.allowedTools]),
        scope: Object.freeze({
          adopterId: claims.adopterId,
          tenantId: claims.tenantId,
          subjectId: claims.sub,
          productSessionId: claims.productSessionId,
          runtimeSessionId: claims.runtimeSessionId,
          invocationId: claims.invocationId,
          workflow: claims.workflow,
        }),
        issuedAt: new Date(claims.iat * 1_000).toISOString(),
        expiresAt: new Date(claims.exp * 1_000).toISOString(),
      };
    } catch (error) {
      if (
        error instanceof LucidMcpCapabilityVerificationError
        || error instanceof LucidMcpCapabilityUnavailableError
      ) {
        throw error;
      }
      if (isTemporarilyUnavailable(error)) {
        throw new LucidMcpCapabilityUnavailableError({ cause: error });
      }
      throw new LucidMcpCapabilityVerificationError({ cause: error });
    }
  }

  private assertDeploymentBinding(
    claims: z.infer<typeof CapabilityClaimsSchema>,
  ): void {
    if (
      claims.adopterId !== this.#config.trustedAdopterId
      || claims.serverId !== this.#config.serverId
      || claims.jti === claims.invocationId
    ) {
      throw new LucidMcpCapabilityVerificationError();
    }
  }

  private assertBoundedLifetime(
    claims: z.infer<typeof CapabilityClaimsSchema>,
  ): void {
    const lifetimeSeconds = claims.exp - claims.iat;
    if (
      lifetimeSeconds <= 0
      || lifetimeSeconds > this.#config.maxCapabilityAgeSeconds
    ) {
      throw new LucidMcpCapabilityVerificationError();
    }
  }
}

export function assertLucidMcpCapabilityActive(
  capability: VerifiedLucidMcpCapability,
  now: Date,
): void {
  const expiresAt = Date.parse(capability.expiresAt);
  if (!Number.isFinite(expiresAt) || now.getTime() >= expiresAt) {
    throw new LucidMcpCapabilityVerificationError();
  }
}

const UNAVAILABLE_JOSE_CODES = new Set([
  'ERR_JOSE_GENERIC',
  'ERR_JWK_INVALID',
  'ERR_JWKS_INVALID',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JWKS_TIMEOUT',
]);

function isTemporarilyUnavailable(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof errors.JOSEError && UNAVAILABLE_JOSE_CODES.has(error.code));
}

function isSafeWebUrl(url: URL): boolean {
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
}
