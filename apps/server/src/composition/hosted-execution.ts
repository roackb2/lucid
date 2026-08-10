import { JoseExecutionAuthority } from '@roackb2/heddle-adopter/authority';
import { DirectHttpExecutionHost, type ExecutionHost } from '@roackb2/heddle-adopter/http-sse';
import { JwtMcpCapabilityVerifier } from '@roackb2/heddle-adopter/mcp';
import type { LucidAuthenticator } from '../auth/authenticator.js';
import type { HostedExecutionConfig } from '../hosted-execution/config.js';
import {
  HostedConversationAdmissionService,
} from '../hosted-execution/conversation/admission-service.js';
import {
  HostedConversationTurnService,
} from '../hosted-execution/conversation/service.js';
import {
  HOSTED_EXECUTION_JWKS_PATH,
  HostedExecutionHttpRouter,
} from '../hosted-execution/http-router.js';
import { LucidProductToolset } from '../hosted-execution/mcp/product-tools.js';
import { StreamableHttpMcpService } from '../hosted-execution/mcp/streamable-http-service.js';
import {
  LUCID_PRODUCT_MCP_TOOLS,
  type LucidProductMcpToolName,
} from '../hosted-execution/mcp/types.js';
import { SingleWorkspaceProjectionReader } from '../hosted-execution/mcp/workspace-projection-reader.js';
import { loadExecutionAuthorityKeyPair } from '../hosted-execution/signing-key.js';
import type { DiscoveryWorkspaceSnapshot } from '../lucid/discovery-types.js';
import { LOCAL_USER_ID } from '../lucid/local-participant.js';
import type { LucidLogger } from '../logger.js';

export type HostedExecutionComposition = {
  http: HostedExecutionHttpRouter;
  close(): Promise<void>;
};

/** Composes the optional local direct-host profile as one all-or-nothing unit. */
export async function createHostedExecutionComposition(input: {
  config: HostedExecutionConfig;
  authenticator: LucidAuthenticator;
  discoveryWorkspace: { snapshot(): Promise<DiscoveryWorkspaceSnapshot> };
  logger: LucidLogger;
  executionHost?: ExecutionHost;
}): Promise<HostedExecutionComposition> {
  const maxTurnSeconds = Math.ceil(input.config.maxTurnMs / 1_000);
  const keyPair = await loadExecutionAuthorityKeyPair(
    input.config.signingJwkPath,
  );
  const issuer = input.config.publicBaseUrl.origin;
  const jwksUrl = new URL(
    HOSTED_EXECUTION_JWKS_PATH,
    input.config.publicBaseUrl,
  );
  const authority = await JoseExecutionAuthority.create({
    issuer,
    adopterId: input.config.adopterId,
    executionAudience: input.config.executionAudience,
    keyId: input.config.keyId,
    executionTtlSeconds: Math.min(5 * 60, maxTurnSeconds),
    mcp: {
      audience: input.config.mcpAudience,
      serverId: input.config.mcpServerId,
      ttlSeconds: maxTurnSeconds,
    },
  }, keyPair);
  const capabilityVerifier = new JwtMcpCapabilityVerifier<LucidProductMcpToolName>({
    issuer,
    audience: input.config.mcpAudience,
    jwksUrl,
    trustedAdopterId: input.config.adopterId,
    serverId: input.config.mcpServerId,
    supportedTools: LUCID_PRODUCT_MCP_TOOLS,
    maxCapabilityAgeSeconds: maxTurnSeconds,
    clockToleranceSeconds: 5,
  });
  const workspaceReader = new SingleWorkspaceProjectionReader({
    tenantId: input.config.tenantId,
    subjectId: LOCAL_USER_ID,
    productSessionId: input.config.productSessionId,
  }, input.discoveryWorkspace);
  const mcp = new StreamableHttpMcpService(
    capabilityVerifier,
    new LucidProductToolset(workspaceReader),
  );
  const executionHost = input.executionHost ?? new DirectHttpExecutionHost({
    baseUrl: input.config.hostBaseUrl,
    localToken: input.config.credentials.localToken(),
  });
  const turns = new HostedConversationTurnService(
    authority,
    executionHost,
    input.config.credentials,
  );
  const conversations = new HostedConversationAdmissionService(
    turns,
    {
      tenantId: input.config.tenantId,
      productSessionId: input.config.productSessionId,
      maxTurnMs: input.config.maxTurnMs,
    },
  );
  const http = new HostedExecutionHttpRouter(
    input.authenticator,
    authority,
    mcp,
    conversations,
    input.logger,
  );

  return {
    http,
    close: () => http.close(),
  };
}
