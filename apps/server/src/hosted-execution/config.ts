import { resolve } from 'node:path';
import {
  McpServerIdSchema,
  OpaqueIdSchema,
  isSafeWebUrl,
} from '@heddleagent/execution-host-client/contracts';
import {
  AgentCoreQualifierSchema,
  AgentCoreRegionSchema,
  AgentCoreRuntimeArnSchema,
} from '@heddleagent/execution-host-client/agentcore';
import type {
  HostedConversationModelCredentialProvider,
} from '@heddleagent/execution-host-client/conversation';
import {
  takeHostedHeartbeatServiceToken,
} from '@heddleagent/execution-host-client/coordinator/node';
import { DirectExecutionHostCredentials } from '@heddleagent/execution-host-client/node';
import { z } from 'zod';
import { EnvironmentHostedModelCredentials } from './model-credentials.js';

const ENABLED_ENV = 'LUCID_HOSTED_EXECUTION_ENABLED';
const SECRET_ENV_NAMES = [
  'LUCID_HOSTED_EXECUTION_LOCAL_TOKEN',
  'LUCID_HOSTED_EXECUTION_MODEL_API_KEY',
  'LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN',
  'LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN',
] as const;
const DIRECT_CREDENTIAL_ENV_NAMES = Object.freeze({
  localToken: SECRET_ENV_NAMES[0],
  modelApiKey: SECRET_ENV_NAMES[1],
});
const HEARTBEAT_COORDINATOR_TOKEN_ENV = SECRET_ENV_NAMES[2];
const HEARTBEAT_COORDINATOR_API_TOKEN_ENV = SECRET_ENV_NAMES[3];
const HostedExecutionEnvironmentSchema = z.object({
  LUCID_HOSTED_EXECUTION_ENABLED: z.literal('true'),
  LUCID_HOSTED_EXECUTION_TRANSPORT: z.enum(['direct', 'agentcore'])
    .default('direct'),
  LUCID_HOSTED_EXECUTION_PUBLIC_URL: z.url(),
  LUCID_HOSTED_EXECUTION_HOST_URL: z.url().optional(),
  LUCID_HOSTED_EXECUTION_LOCAL_TOKEN: z.string().trim().min(32).max(4_096)
    .optional(),
  LUCID_HOSTED_EXECUTION_MODEL_API_KEY: z.string().trim().min(8).max(4_096),
  LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN: z.string().trim().min(32)
    .max(4_096)
    .optional(),
  LUCID_HOSTED_HEARTBEAT_COORDINATOR_URL: z.url().optional(),
  LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN: z.string().trim().min(32)
    .max(4_096)
    .optional(),
  LUCID_HOSTED_EXECUTION_AGENTCORE_REGION: AgentCoreRegionSchema.optional(),
  LUCID_HOSTED_EXECUTION_AGENTCORE_RUNTIME_ARN:
    AgentCoreRuntimeArnSchema.optional(),
  LUCID_HOSTED_EXECUTION_AGENTCORE_QUALIFIER:
    AgentCoreQualifierSchema.optional(),
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

  const hostUrl = environment.LUCID_HOSTED_EXECUTION_HOST_URL
    ? new URL(environment.LUCID_HOSTED_EXECUTION_HOST_URL)
    : undefined;
  if (hostUrl && !isSafeWebUrl(hostUrl)) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HOSTED_EXECUTION_HOST_URL'],
      message: 'must use HTTPS or loopback HTTP without credentials, query, or fragment',
    });
  }

  const coordinatorUrl = environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_URL
    ? new URL(environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_URL)
    : undefined;
  if (
    coordinatorUrl
    && (!isSafeWebUrl(coordinatorUrl) || !isOriginUrl(coordinatorUrl))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HOSTED_HEARTBEAT_COORDINATOR_URL'],
      message: 'must be an HTTPS or loopback HTTP origin without credentials, query, or fragment',
    });
  }
  if (
    Boolean(coordinatorUrl)
    !== Boolean(environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HOSTED_HEARTBEAT_COORDINATOR_URL'],
      message: 'and its API token must be configured together',
    });
  }
  if (
    coordinatorUrl
    && !environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN
  ) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN'],
      message: 'is required when Lucid publishes tasks to a coordinator',
    });
  }
  if (
    environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN
    && environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN
    && environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN
      === environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN
  ) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN'],
      message: 'must differ from the heartbeat delegation token',
    });
  }

  if (environment.LUCID_HOSTED_EXECUTION_TRANSPORT === 'direct') {
    if (!hostUrl) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_HOSTED_EXECUTION_HOST_URL'],
        message: 'is required for direct transport',
      });
    }
    if (!environment.LUCID_HOSTED_EXECUTION_LOCAL_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_HOSTED_EXECUTION_LOCAL_TOKEN'],
        message: 'is required for direct transport',
      });
    }
    if (
      environment.LUCID_HOSTED_EXECUTION_AGENTCORE_REGION
      || environment.LUCID_HOSTED_EXECUTION_AGENTCORE_RUNTIME_ARN
      || environment.LUCID_HOSTED_EXECUTION_AGENTCORE_QUALIFIER
    ) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_HOSTED_EXECUTION_TRANSPORT'],
        message: 'direct transport cannot include AgentCore configuration',
      });
    }
  } else {
    if (!environment.LUCID_HOSTED_EXECUTION_AGENTCORE_REGION) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_HOSTED_EXECUTION_AGENTCORE_REGION'],
        message: 'is required for AgentCore transport',
      });
    }
    if (!environment.LUCID_HOSTED_EXECUTION_AGENTCORE_RUNTIME_ARN) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_HOSTED_EXECUTION_AGENTCORE_RUNTIME_ARN'],
        message: 'is required for AgentCore transport',
      });
    }
    if (hostUrl || environment.LUCID_HOSTED_EXECUTION_LOCAL_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_HOSTED_EXECUTION_TRANSPORT'],
        message: 'AgentCore transport cannot include direct-host configuration',
      });
    }
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

export type HostedExecutionTransportConfig = {
  mode: 'direct';
  baseUrl: URL;
  credentials: DirectExecutionHostCredentials;
} | {
  mode: 'agentcore';
  region: string;
  runtimeArn: string;
  qualifier?: string;
};

export type HostedExecutionConfig = {
  publicBaseUrl: URL;
  signingJwkPath: string;
  adopterId: string;
  tenantId: string;
  productSessionId: string;
  keyId: string;
  executionAudience: string;
  mcpAudience: string;
  mcpServerId: string;
  maxTurnMs: number;
  transport: HostedExecutionTransportConfig;
  modelCredentials: HostedConversationModelCredentialProvider;
  heartbeatDelegationToken?: string;
  heartbeatCoordinator?: {
    baseUrl: URL;
    apiToken: string;
  };
};

/** Resolves one optional hosted profile and removes credentials from env. */
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
  const directCredentials = parsed.LUCID_HOSTED_EXECUTION_TRANSPORT === 'direct'
    ? DirectExecutionHostCredentials.takeFromEnvironment(
        environment,
        DIRECT_CREDENTIAL_ENV_NAMES,
      )
    : undefined;
  const modelCredentials = directCredentials
    ?? EnvironmentHostedModelCredentials.take(
      environment,
      DIRECT_CREDENTIAL_ENV_NAMES.modelApiKey,
    );
  const heartbeatDelegationToken = takeHostedHeartbeatServiceToken(
    environment,
    HEARTBEAT_COORDINATOR_TOKEN_ENV,
  );
  const heartbeatCoordinatorApiToken = takeHostedHeartbeatServiceToken(
    environment,
    HEARTBEAT_COORDINATOR_API_TOKEN_ENV,
  );
  const transport: HostedExecutionTransportConfig = directCredentials
    ? {
        mode: 'direct',
        baseUrl: new URL(parsed.LUCID_HOSTED_EXECUTION_HOST_URL!),
        credentials: directCredentials,
      }
    : {
        mode: 'agentcore',
        region: parsed.LUCID_HOSTED_EXECUTION_AGENTCORE_REGION!,
        runtimeArn: parsed.LUCID_HOSTED_EXECUTION_AGENTCORE_RUNTIME_ARN!,
        ...(parsed.LUCID_HOSTED_EXECUTION_AGENTCORE_QUALIFIER
          ? { qualifier: parsed.LUCID_HOSTED_EXECUTION_AGENTCORE_QUALIFIER }
          : {}),
      };

  return Object.freeze({
    publicBaseUrl: new URL(parsed.LUCID_HOSTED_EXECUTION_PUBLIC_URL),
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
    transport: Object.freeze(transport),
    modelCredentials,
    ...(heartbeatDelegationToken
      ? { heartbeatDelegationToken }
      : {}),
    ...(heartbeatCoordinatorApiToken
      ? {
          heartbeatCoordinator: Object.freeze({
            baseUrl: new URL(
              parsed.LUCID_HOSTED_HEARTBEAT_COORDINATOR_URL!,
            ),
            apiToken: heartbeatCoordinatorApiToken,
          }),
        }
      : {}),
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

function isOriginUrl(url: URL): boolean {
  return (url.pathname === '/' || url.pathname === '')
    && !url.search
    && !url.hash;
}
