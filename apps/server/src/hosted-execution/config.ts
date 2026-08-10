import { resolve } from 'node:path';
import {
  McpServerIdSchema,
  OpaqueIdSchema,
  isSafeWebUrl,
} from '@roackb2/heddle-adopter/contracts';
import { z } from 'zod';
import type {
  HostedConversationModelCredentialProvider,
} from './conversation/types.js';

const ENABLED_ENV = 'LUCID_HOSTED_EXECUTION_ENABLED';
const SECRET_ENV_NAMES = [
  'LUCID_HOSTED_EXECUTION_LOCAL_TOKEN',
  'LUCID_HOSTED_EXECUTION_MODEL_API_KEY',
] as const;

const HostedExecutionEnvironmentSchema = z.object({
  LUCID_HOSTED_EXECUTION_ENABLED: z.literal('true'),
  LUCID_HOSTED_EXECUTION_PUBLIC_URL: z.url(),
  LUCID_HOSTED_EXECUTION_HOST_URL: z.url(),
  LUCID_HOSTED_EXECUTION_LOCAL_TOKEN: z.string().trim().min(32).max(4_096),
  LUCID_HOSTED_EXECUTION_MODEL_API_KEY: z.string().trim().min(8).max(4_096),
  LUCID_HOSTED_EXECUTION_SIGNING_JWK_PATH: z.string().trim().min(1),
  LUCID_HOSTED_EXECUTION_ADOPTER_ID: OpaqueIdSchema.default('lucid-local'),
  LUCID_HOSTED_EXECUTION_TENANT_ID: OpaqueIdSchema.default('lucid-local'),
  LUCID_HOSTED_EXECUTION_PRODUCT_SESSION_ID: OpaqueIdSchema
    .default('local-discovery-workspace'),
  LUCID_HOSTED_EXECUTION_KEY_ID: OpaqueIdSchema.default('lucid-local-key'),
  LUCID_HOSTED_EXECUTION_AUDIENCE: z.string().trim().min(1).max(512)
    .default('urn:heddle-execution-host:lucid-local'),
  LUCID_HOSTED_EXECUTION_MCP_AUDIENCE: z.string().trim().min(1).max(512)
    .default('urn:lucid:mcp:local'),
  LUCID_HOSTED_EXECUTION_MCP_SERVER_ID: McpServerIdSchema
    .default('lucid_product'),
  LUCID_HOSTED_EXECUTION_MAX_TURN_MS: z.coerce.number().int()
    .min(30_000)
    .max(15 * 60_000)
    .default(10 * 60_000),
}).passthrough().superRefine((environment, context) => {
  const publicUrl = new URL(environment.LUCID_HOSTED_EXECUTION_PUBLIC_URL);
  if (!isSafeWebUrl(publicUrl) || !isOriginUrl(publicUrl)) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HOSTED_EXECUTION_PUBLIC_URL'],
      message: 'must be an HTTPS or loopback HTTP origin without credentials, query, or fragment',
    });
  }

  const hostUrl = new URL(environment.LUCID_HOSTED_EXECUTION_HOST_URL);
  if (!isSafeWebUrl(hostUrl)) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HOSTED_EXECUTION_HOST_URL'],
      message: 'must use HTTPS or loopback HTTP without credentials, query, or fragment',
    });
  }

  if (
    environment.LUCID_HOSTED_EXECUTION_AUDIENCE
    === environment.LUCID_HOSTED_EXECUTION_MCP_AUDIENCE
  ) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HOSTED_EXECUTION_MCP_AUDIENCE'],
      message: 'must differ from the execution audience',
    });
  }
});

/** Credentials are non-enumerable so routine object inspection cannot leak them. */
export class HostedExecutionCredentials
implements HostedConversationModelCredentialProvider {
  readonly #localToken: string;
  readonly #modelApiKey: string;

  constructor(input: { localToken: string; modelApiKey: string }) {
    this.#localToken = input.localToken;
    this.#modelApiKey = input.modelApiKey;
  }

  localToken(): string {
    return this.#localToken;
  }

  async resolveModelApiKey(): Promise<string> {
    return this.#modelApiKey;
  }
}

export type HostedExecutionConfig = {
  publicBaseUrl: URL;
  hostBaseUrl: URL;
  signingJwkPath: string;
  adopterId: string;
  tenantId: string;
  productSessionId: string;
  keyId: string;
  executionAudience: string;
  mcpAudience: string;
  mcpServerId: string;
  maxTurnMs: number;
  credentials: HostedExecutionCredentials;
};

/** Resolves the optional local direct-host profile and removes secrets from env. */
export function resolveHostedExecutionConfig(
  environment: NodeJS.ProcessEnv = process.env,
  repoRoot: string,
): HostedExecutionConfig | undefined {
  const enabled = environment[ENABLED_ENV]?.trim() ?? 'false';
  if (enabled === 'false') {
    assertNoDisabledSecrets(environment);
    return undefined;
  }
  if (enabled !== 'true') {
    throw new Error(`${ENABLED_ENV} must be true or false.`);
  }

  const parsed = HostedExecutionEnvironmentSchema.parse(environment);
  const credentials = new HostedExecutionCredentials({
    localToken: parsed.LUCID_HOSTED_EXECUTION_LOCAL_TOKEN,
    modelApiKey: parsed.LUCID_HOSTED_EXECUTION_MODEL_API_KEY,
  });
  clearSecretEnvironment(environment);

  return Object.freeze({
    publicBaseUrl: new URL(parsed.LUCID_HOSTED_EXECUTION_PUBLIC_URL),
    hostBaseUrl: new URL(parsed.LUCID_HOSTED_EXECUTION_HOST_URL),
    signingJwkPath: resolve(
      repoRoot,
      parsed.LUCID_HOSTED_EXECUTION_SIGNING_JWK_PATH,
    ),
    adopterId: parsed.LUCID_HOSTED_EXECUTION_ADOPTER_ID,
    tenantId: parsed.LUCID_HOSTED_EXECUTION_TENANT_ID,
    productSessionId: parsed.LUCID_HOSTED_EXECUTION_PRODUCT_SESSION_ID,
    keyId: parsed.LUCID_HOSTED_EXECUTION_KEY_ID,
    executionAudience: parsed.LUCID_HOSTED_EXECUTION_AUDIENCE,
    mcpAudience: parsed.LUCID_HOSTED_EXECUTION_MCP_AUDIENCE,
    mcpServerId: parsed.LUCID_HOSTED_EXECUTION_MCP_SERVER_ID,
    maxTurnMs: parsed.LUCID_HOSTED_EXECUTION_MAX_TURN_MS,
    credentials,
  });
}

function assertNoDisabledSecrets(environment: NodeJS.ProcessEnv): void {
  const configured = SECRET_ENV_NAMES.filter((name) => environment[name]?.trim());
  if (configured.length > 0) {
    throw new Error(
      `Hosted execution credentials are configured while ${ENABLED_ENV} is false.`,
    );
  }
}

function clearSecretEnvironment(environment: NodeJS.ProcessEnv): void {
  SECRET_ENV_NAMES.forEach((name) => delete environment[name]);
}

function isOriginUrl(url: URL): boolean {
  return (url.pathname === '/' || url.pathname === '')
    && !url.search
    && !url.hash;
}
