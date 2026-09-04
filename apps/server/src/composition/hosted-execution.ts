import { JoseExecutionAuthority } from '@heddleagent/execution-host-client/authority';
import { AgentCoreExecutionHost } from '@heddleagent/execution-host-client/agentcore';
import {
  DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
  DEFAULT_ADOPTER_JWKS_PATH,
} from '@heddleagent/execution-host-client/adopter';
import {
  DurableHostedConversationTurnService,
  HostedConversationTurnService,
  type HostedConversationTurnLifecycleStore,
} from '@heddleagent/execution-host-client/conversation';
import {
  HostedHeartbeatExecutionService,
  type HostedHeartbeatAdmissionLifecycle,
} from '@heddleagent/execution-host-client/coordinator';
import {
  NodeHostedHeartbeatExecutionHttpService,
} from '@heddleagent/execution-host-client/coordinator/node';
import { DirectHttpExecutionHost, type ExecutionHost } from '@heddleagent/execution-host-client/http-sse';
import { JwtMcpCapabilityVerifier } from '@heddleagent/execution-host-client/mcp';
import { NodeStreamableHttpMcpService } from '@heddleagent/execution-host-client/mcp/node';
import {
  loadExecutionAuthorityKeyPairFromFile,
  NodeExecutionAdopterHttpService,
} from '@heddleagent/execution-host-client/node';
import type { LucidAuthenticator } from '../auth/authenticator.js';
import type { HostedExecutionConfig } from '../hosted-execution/config.js';
import {
  HostedConversationAuthorizationError,
  HostedConversationAdmissionService,
} from '../hosted-execution/conversation/admission-service.js';
import { LucidHeartbeatExecutionLifecycle } from '../hosted-execution/heartbeat/execution-lifecycle.js';
import {
  HostedExecutionHttpRouter,
} from '../hosted-execution/http-router.js';
import { createLucidProductToolset } from '../hosted-execution/mcp/product-tools.js';
import {
  LUCID_CONVERSATION_MCP_TOOLS,
  LUCID_PRODUCT_MCP_TOOLS,
  type LucidProductMcpToolName,
} from '../hosted-execution/mcp/types.js';
import { UserWorkspaceProjectionReader } from '../hosted-execution/mcp/workspace-projection-reader.js';
import {
  CapabilityScopedAgentWorkToolExecutor,
} from '../hosted-execution/mcp/agent-work-tool-executor.js';
import {
  CapabilityScopedInformationNetworkPublisher,
} from '../hosted-execution/mcp/information-network-publisher.js';
import type { DiscoveryWorkspaceSnapshot } from '../lucid/discovery-types.js';
import type { AgentWorkService } from '../lucid/agent/work-service.js';
import type { AgentJobService } from '../lucid/agent/jobs/service.js';
import type {
  InformationNetworkPublishingService,
} from '../lucid/information-network/publishing.js';
import type {
  PublishingJobWorkService,
} from '../lucid/information-network/publishing-job-work-service.js';
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
  heartbeatAdmission: HostedHeartbeatAdmissionLifecycle;
  agentWork: Pick<
    AgentWorkService,
    | 'claimWork'
    | 'completeWork'
    | 'failWork'
    | 'interruptWork'
    | 'executeTool'
  >;
  agentJobs: Pick<AgentJobService, 'readAgentJob'>;
  publishingJobWork: Pick<
    PublishingJobWorkService,
    'claimWork' | 'completeWork' | 'failWork' | 'interruptWork'
  >;
  informationNetworkPublishing: Pick<
    InformationNetworkPublishingService,
    'publishTextPost'
  >;
  executionHost?: ExecutionHost;
}): Promise<HostedExecutionComposition> {
  const maxTurnSeconds = Math.ceil(input.config.maxTurnMs / 1_000);
  const keyPair = await loadExecutionAuthorityKeyPairFromFile(
    input.config.signingJwkPath,
  );
  const issuer = input.config.publicBaseUrl.origin;
  const jwksUrl = new URL(
    DEFAULT_ADOPTER_JWKS_PATH,
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
  const agentWork = new CapabilityScopedAgentWorkToolExecutor({
    tenantId: input.config.tenantId,
    productSessionId: input.config.productSessionId,
  }, input.agentWork);
  const informationNetworkPublisher =
    new CapabilityScopedInformationNetworkPublisher({
      tenantId: input.config.tenantId,
      productSessionId: input.config.productSessionId,
    }, input.informationNetworkPublishing);
  const mcp = new NodeStreamableHttpMcpService({
    capabilityVerifier,
    toolset: createLucidProductToolset(
      workspaceReader,
      agentWork,
      informationNetworkPublisher,
    ),
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
    mcp: { allowedTools: LUCID_CONVERSATION_MCP_TOOLS },
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
      jwks: DEFAULT_ADOPTER_JWKS_PATH,
      conversationTurns: DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
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
  const heartbeatExecutions = new NodeHostedHeartbeatExecutionHttpService({
    executions: new HostedHeartbeatExecutionService({
      authority,
      lifecycle: new LucidHeartbeatExecutionLifecycle(
        input.agentJobs,
        input.agentWork,
        input.publishingJobWork,
        {
          tenantId: input.config.tenantId,
          productSessionId: input.config.productSessionId,
        },
      ),
      runtimeSessionNamespace: 'lucid',
      maxExecutionMs: input.config.maxTurnMs,
    }),
    admission: input.heartbeatAdmission,
    apiToken: input.config.heartbeatExecutionToken,
    reportFailure: (failure) => {
      input.logger.error(
        failure,
        'lucid.hosted_heartbeat.execution_lifecycle_failed',
      );
    },
  });
  const http = new HostedExecutionHttpRouter(
    adopterHttp,
    mcp,
    input.logger,
    heartbeatExecutions,
  );

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
