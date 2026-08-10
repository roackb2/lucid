import { randomUUID } from 'node:crypto';
import {
  CompactSign,
  SignJWT,
  compactVerify,
  exportJWK,
  type CryptoKey,
  type JWK,
  type JSONWebKeySet,
} from 'jose';
import { z } from 'zod';
import {
  EXECUTION_ASSERTION_TYPE,
  MCP_CAPABILITY_TYPE,
  type ExecutionAuthority,
  type ExecutionAuthorityConfig,
  type ExecutionAuthorityIssueInput,
  type HostedExecutionScope,
  type IssuedExecutionAuthority,
  type IssuedExecutionAuthorityMetadata,
} from './types.js';

const SIGNING_ALGORITHM = 'ES256';
const MAX_ALLOWED_TOOL_NAME_CHARACTERS = 512;

const SafeIssuerSchema = z.url().refine(
  (value) => isSafeWebUrl(new URL(value)),
  'must use HTTPS or loopback HTTP and contain no credentials, query, or fragment',
);

const OpaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/, 'must be an opaque, path-free identifier');
const RuntimeSessionIdSchema = z.string().trim().min(33).max(256);
const McpServerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be a Heddle-compatible MCP server identifier');
const McpToolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'must be a collision-free MCP tool name');
const AllowedToolsSchema = z
  .array(McpToolNameSchema)
  .min(1)
  .max(16)
  .refine((tools) => new Set(tools).size === tools.length, {
    message: 'must contain unique MCP tool names',
  })
  .refine(
    (tools) => tools.reduce((total, toolName) => total + toolName.length, 0)
      <= MAX_ALLOWED_TOOL_NAME_CHARACTERS,
    { message: 'contains too many aggregate tool-name characters' },
  );
const HostedExecutionScopeSchema = z.object({
  tenantId: OpaqueIdSchema,
  subjectId: OpaqueIdSchema,
  productSessionId: OpaqueIdSchema,
}).strict();
const ExecutionAuthorityIssueInputSchema = z.object({
  scope: HostedExecutionScopeSchema,
  runtimeSessionId: RuntimeSessionIdSchema,
  invocationId: OpaqueIdSchema,
  workflow: z.literal('conversation-turn'),
  allowedTools: AllowedToolsSchema,
}).strict();
const ExecutionAuthorityConfigSchema = z.object({
  issuer: SafeIssuerSchema,
  adopterId: OpaqueIdSchema,
  executionAudience: z.string().trim().min(1).max(512),
  mcpAudience: z.string().trim().min(1).max(512),
  mcpServerId: McpServerIdSchema,
  keyId: OpaqueIdSchema,
  executionTtlSeconds: z.number().int().min(1).max(15 * 60),
  mcpTtlSeconds: z.number().int().min(1).max(15 * 60),
}).strict().superRefine((config, context) => {
  if (config.executionAudience === config.mcpAudience) {
    context.addIssue({
      code: 'custom',
      path: ['mcpAudience'],
      message: 'must be distinct from the execution audience',
    });
  }
  if (config.mcpTtlSeconds < config.executionTtlSeconds) {
    context.addIssue({
      code: 'custom',
      path: ['mcpTtlSeconds'],
      message: 'must not expire before execution admission authority',
    });
  }
});
const PublicP256JwkSchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]+$/),
  y: z.string().regex(/^[A-Za-z0-9_-]+$/),
}).passthrough().superRefine((jwk, context) => {
  const privateFields = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];
  if (privateFields.some((field) => field in jwk)) {
    context.addIssue({
      code: 'custom',
      message: 'must not contain private key material',
    });
  }
});

export type JoseExecutionAuthorityOptions = {
  now?: () => Date;
  createCapabilityId?: () => string;
};

/**
 * JOSE adapter for Lucid's hosted-execution authority port. The private key is
 * held in an ECMAScript private field and never included in projections.
 */
export class JoseExecutionAuthority implements ExecutionAuthority {
  readonly #config: ExecutionAuthorityConfig;
  readonly #privateKey: CryptoKey;
  readonly #publicJwk: Readonly<JWK>;
  readonly #now: () => Date;
  readonly #createCapabilityId: () => string;

  private constructor(
    config: ExecutionAuthorityConfig,
    key: { privateKey: CryptoKey; publicJwk: JWK },
    options: JoseExecutionAuthorityOptions = {},
  ) {
    this.#config = ExecutionAuthorityConfigSchema.parse(config);
    assertPrivateSigningKey(key.privateKey);
    this.#privateKey = key.privateKey;
    this.#publicJwk = projectPublicJwk(key.publicJwk, this.#config.keyId);
    this.#now = options.now ?? (() => new Date());
    this.#createCapabilityId = options.createCapabilityId ?? randomUUID;
  }

  static async create(
    config: ExecutionAuthorityConfig,
    keyPair: { privateKey: CryptoKey; publicKey: CryptoKey },
    options: JoseExecutionAuthorityOptions = {},
  ): Promise<JoseExecutionAuthority> {
    assertPrivateSigningKey(keyPair.privateKey);
    assertPublicVerificationKey(keyPair.publicKey);
    await assertMatchingKeyPair(keyPair);
    const publicJwk = await exportJWK(keyPair.publicKey);
    return new JoseExecutionAuthority(
      config,
      { privateKey: keyPair.privateKey, publicJwk },
      options,
    );
  }

  async issue(
    input: ExecutionAuthorityIssueInput,
  ): Promise<IssuedExecutionAuthority> {
    const authority = ExecutionAuthorityIssueInputSchema.parse(input);
    const issuedAtSeconds = Math.floor(this.#now().getTime() / 1_000);
    if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds < 0) {
      throw new Error('Hosted execution authority could not resolve a valid issue time.');
    }

    const capabilityId = OpaqueIdSchema.parse(this.#createCapabilityId());
    if (capabilityId === authority.invocationId) {
      throw new Error('MCP capability identity must be distinct from the invocation identity.');
    }

    const executionExpiresAtSeconds = issuedAtSeconds
      + this.#config.executionTtlSeconds;
    const mcpExpiresAtSeconds = issuedAtSeconds + this.#config.mcpTtlSeconds;
    const [executionAssertion, mcpCapability] = await Promise.all([
      this.#signExecutionAssertion(
        authority,
        issuedAtSeconds,
        executionExpiresAtSeconds,
      ),
      this.#signMcpCapability(
        authority,
        capabilityId,
        issuedAtSeconds,
        mcpExpiresAtSeconds,
      ),
    ]);

    return new ProtectedIssuedExecutionAuthority(
      executionAssertion,
      mcpCapability,
      {
        scope: freezeScope(authority.scope, this.#config.adopterId),
        runtimeSessionId: authority.runtimeSessionId,
        invocationId: authority.invocationId,
        capabilityId,
        workflow: authority.workflow,
        allowedTools: Object.freeze([...authority.allowedTools]),
        issuedAt: toIsoTimestamp(issuedAtSeconds),
        executionExpiresAt: toIsoTimestamp(executionExpiresAtSeconds),
        mcpExpiresAt: toIsoTimestamp(mcpExpiresAtSeconds),
      },
    );
  }

  publicJwks(): JSONWebKeySet {
    return {
      keys: [{ ...this.#publicJwk }],
    };
  }

  #signExecutionAssertion(
    input: z.infer<typeof ExecutionAuthorityIssueInputSchema>,
    issuedAt: number,
    expiresAt: number,
  ): Promise<string> {
    return new SignJWT({
      contractVersion: 1,
      adopterId: this.#config.adopterId,
      tenantId: input.scope.tenantId,
      productSessionId: input.scope.productSessionId,
      runtimeSessionId: input.runtimeSessionId,
      workflow: input.workflow,
    })
      .setProtectedHeader({
        alg: SIGNING_ALGORITHM,
        kid: this.#config.keyId,
        typ: EXECUTION_ASSERTION_TYPE,
      })
      .setIssuer(this.#config.issuer)
      .setAudience(this.#config.executionAudience)
      .setSubject(input.scope.subjectId)
      .setJti(input.invocationId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.#privateKey);
  }

  #signMcpCapability(
    input: z.infer<typeof ExecutionAuthorityIssueInputSchema>,
    capabilityId: string,
    issuedAt: number,
    expiresAt: number,
  ): Promise<string> {
    return new SignJWT({
      contractVersion: 1,
      adopterId: this.#config.adopterId,
      tenantId: input.scope.tenantId,
      productSessionId: input.scope.productSessionId,
      runtimeSessionId: input.runtimeSessionId,
      invocationId: input.invocationId,
      workflow: input.workflow,
      serverId: this.#config.mcpServerId,
      allowedTools: [...input.allowedTools],
    })
      .setProtectedHeader({
        alg: SIGNING_ALGORITHM,
        kid: this.#config.keyId,
        typ: MCP_CAPABILITY_TYPE,
      })
      .setIssuer(this.#config.issuer)
      .setAudience(this.#config.mcpAudience)
      .setSubject(input.scope.subjectId)
      .setJti(capabilityId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.#privateKey);
  }
}

class ProtectedIssuedExecutionAuthority implements IssuedExecutionAuthority {
  readonly metadata: IssuedExecutionAuthorityMetadata;
  readonly #executionAssertion: string;
  readonly #mcpCapability: string;

  constructor(
    executionAssertion: string,
    mcpCapability: string,
    metadata: IssuedExecutionAuthorityMetadata,
  ) {
    this.#executionAssertion = executionAssertion;
    this.#mcpCapability = mcpCapability;
    this.metadata = Object.freeze({ ...metadata });
  }

  executionAssertion(): string {
    return this.#executionAssertion;
  }

  mcpCapability(): string {
    return this.#mcpCapability;
  }

  toJSON(): IssuedExecutionAuthorityMetadata {
    return this.metadata;
  }
}

function projectPublicJwk(jwk: JWK, keyId: string): Readonly<JWK> {
  const parsed = PublicP256JwkSchema.parse(jwk);
  return Object.freeze({
    kty: parsed.kty,
    crv: parsed.crv,
    x: parsed.x,
    y: parsed.y,
    alg: SIGNING_ALGORITHM,
    kid: keyId,
    use: 'sig',
  });
}

function assertPrivateSigningKey(key: CryptoKey): void {
  const algorithm = key.algorithm as { name: string; namedCurve?: string };
  const accepted = key.type === 'private'
    && algorithm.name === 'ECDSA'
    && algorithm.namedCurve === 'P-256'
    && key.usages.includes('sign');
  if (!accepted) {
    throw new Error('Hosted execution authority requires an ES256 private signing key.');
  }
}

function assertPublicVerificationKey(key: CryptoKey): void {
  const algorithm = key.algorithm as { name: string; namedCurve?: string };
  const accepted = key.type === 'public'
    && algorithm.name === 'ECDSA'
    && algorithm.namedCurve === 'P-256'
    && key.usages.includes('verify');
  if (!accepted) {
    throw new Error('Hosted execution authority requires an ES256 public verification key.');
  }
}

async function assertMatchingKeyPair(keyPair: {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}): Promise<void> {
  try {
    const probe = await new CompactSign(
      new TextEncoder().encode('lucid-hosted-execution-key-pair'),
    )
      .setProtectedHeader({ alg: SIGNING_ALGORITHM })
      .sign(keyPair.privateKey);
    await compactVerify(probe, keyPair.publicKey, {
      algorithms: [SIGNING_ALGORITHM],
    });
  } catch {
    throw new Error('Hosted execution authority signing keys do not match.');
  }
}

function freezeScope(
  scope: z.infer<typeof HostedExecutionScopeSchema>,
  adopterId: string,
): HostedExecutionScope {
  return Object.freeze({ adopterId, ...scope });
}

function toIsoTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1_000).toISOString();
}

function isSafeWebUrl(url: URL): boolean {
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
}
