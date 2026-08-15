import { JoseExecutionAuthority } from '@heddleagent/execution-host-client/authority';
import {
  DurableHostedConversationTurnService,
  HostedConversationTurnService,
  type HostedConversationTurnLifecycleStore,
} from '@heddleagent/execution-host-client/conversation';
import { DirectHttpExecutionHost, type ExecutionHost } from '@heddleagent/execution-host-client/http-sse';
import { JwtMcpCapabilityVerifier } from '@heddleagent/execution-host-client/mcp';
import { NodeStreamableHttpMcpService } from '@heddleagent/execution-host-client/mcp/node';
import {
  loadExecutionAuthorityKeyPairFromFile,
  NodeExecutionAdopterHttpService,
} from '@heddleagent/execution-host-client/node';
import type { LucidAuthenticator } from '../auth/authenticator.js';
import type { HostedExecutionConfig } from '../hosted-execution/config.js';
import { AgentCoreExecutionHost } from '../hosted-execution/agentcore/execution-host.js';
import {
  HostedConversationAuthorizationError,
  HostedConversationAdmissionService,
} from '../hosted-execution/conversation/admission-service.js';
import {
  HOSTED_EXECUTION_JWKS_PATH,
  HOSTED_CONVERSATION_TURNS_PATH,
  HostedExecutionHttpRouter,
} from '../hosted-execution/http-router.js';
import { createLucidProductToolset } from '../hosted-execution/mcp/product-tools.js';
import {
  LUCID_PRODUCT_MCP_TOOLS,
  type LucidProductMcpToolName,
} from '../hosted-execution/mcp/types.js';
import { UserWorkspaceProjectionReader } from '../hosted-execution/mcp/workspace-projection-reader.js';
import type { DiscoveryWorkspaceSnapshot } from '../lucid/discovery-types.js';
import type { LucidLogger } from '../logger.js';

export type HostedExecutionComposition = {
  http: HostedExecutionHttpRouter;
  close(): Promise<void>;
};

/** Composes one optional hosted-execution profile as an all-or-nothing unit. */
export async function createHostedExecutionComposition(input: {
  config: HostedExecutionConfig;
  authenticator: LucidAuthenticator;
  discoveryWorkspace: {
    snapshot(userId: string): Promise<DiscoveryWorkspaceSnapshot>;
  };
  logger: LucidLogger;
  conversationLifecycle: HostedConversationTurnLifecycleStore;
  executionHost?: ExecutionHost;
}): Promise<HostedExecutionComposition> {
  const maxTurnSeconds = Math.ceil(input.config.maxTurnMs / 1_000);
  const keyPair = await loadExecutionAuthorityKeyPairFromFile(
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
  const workspaceReader = new UserWorkspaceProjectionReader({
    tenantId: input.config.tenantId,
    productSessionId: input.config.productSessionId,
  }, input.discoveryWorkspace);
  const mcp = new NodeStreamableHttpMcpService({
    capabilityVerifier,
    toolset: createLucidProductToolset(workspaceReader),
  });
  let ownedAgentCoreHost: AgentCoreExecutionHost | undefined;
  let executionHost = input.executionHost;
  if (!executionHost && input.config.transport.mode === 'direct') {
    executionHost = new DirectHttpExecutionHost({
      baseUrl: input.config.transport.baseUrl,
      localToken: input.config.transport.credentials.localToken(),
    });
  }
  if (!executionHost && input.config.transport.mode === 'agentcore') {
    ownedAgentCoreHost = new AgentCoreExecutionHost({
      region: input.config.transport.region,
      runtimeArn: input.config.transport.runtimeArn,
      qualifier: input.config.transport.qualifier,
    });
    executionHost = ownedAgentCoreHost;
  }
  if (!executionHost) {
    throw new Error('Hosted execution transport could not be composed.');
  }
  const baseTurns = new HostedConversationTurnService({
    authority,
    executionHost,
    modelCredentials: input.config.modelCredentials,
    mcp: { allowedTools: LUCID_PRODUCT_MCP_TOOLS },
  });
  const turns = new DurableHostedConversationTurnService({
    turns: baseTurns,
    store: input.conversationLifecycle,
  });
  const conversations = new HostedConversationAdmissionService(
    turns,
    {
      tenantId: input.config.tenantId,
      productSessionId: input.config.productSessionId,
      maxTurnMs: input.config.maxTurnMs,
    },
  );
  const adopterHttp = new NodeExecutionAdopterHttpService({
    authority,
    authenticator: input.authenticator,
    conversations,
    paths: {
      jwks: HOSTED_EXECUTION_JWKS_PATH,
      conversationTurns: HOSTED_CONVERSATION_TURNS_PATH,
    },
    projectError: (error) => (
      error instanceof HostedConversationAuthorizationError
        ? { statusCode: 403, message: error.message }
        : undefined
    ),
    reportFailure: (failure) => {
      input.logger.warn(failure, 'lucid.hosted_execution.request_failed');
    },
  });
  const http = new HostedExecutionHttpRouter(adopterHttp, mcp, input.logger);

  return {
    http,
    close: async () => {
      try {
        await http.close();
      } finally {
        ownedAgentCoreHost?.close();
      }
    },
  };
}
