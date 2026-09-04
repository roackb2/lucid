/**
 * Builds and owns Lucid's PostgreSQL product persistence.
 *
 * Runtime startup never mutates the shared schema. Deployments and local
 * development must run the explicit migration command first.
 */
import type { LucidConfig } from '../config.js';
import { PostgresUserNetworkStore } from '../lucid/network/postgres-store.js';
import type { UserNetworkStore } from '../lucid/network/store.js';
import {
  PostgresInformationNetworkStore,
} from '../lucid/information-network/postgres-store.js';
import type {
  InformationNetworkPublicationStore,
  InformationNetworkStore,
} from '../lucid/information-network/store.js';
import {
  PostgresAgentCommunicationStore,
} from '../lucid/agent/communication/postgres-store.js';
import type {
  AgentCommunicationStore,
} from '../lucid/agent/communication/store.js';
import {
  PostgresAgentWakeStore,
} from '../lucid/agent/postgres-store.js';
import type { AgentWakeStore } from '../lucid/agent/store.js';
import {
  PostgresAgentJobStore,
} from '../lucid/agent/jobs/postgres-store.js';
import type {
  AgentJobStore,
} from '../lucid/agent/jobs/store.js';
import { AgentJobService } from '../lucid/agent/jobs/service.js';
import { LOCAL_AGENT_ID } from '../lucid/local-user.js';
import {
  PostgresDiscoveryWorkspaceStore,
} from '../lucid/workspace/postgres-store.js';
import type { DiscoveryWorkspaceStore } from '../lucid/workspace/store.js';
import { PostgresDatabase } from '../infrastructure/postgres/database.js';
import {
  createPostgresHostedConversationTurnLifecycleStore,
} from '@heddleagent/postgres/execution-host/conversations';
import type {
  HostedConversationTurnLifecycleStore,
} from '@heddleagent/execution-host-client/conversation';
import {
  PostgresHostedConversationHistoryStore,
} from '../hosted-execution/conversation/postgres-history-store.js';
import type {
  HostedConversationHistoryStore,
} from '../hosted-execution/conversation/store.js';
import {
  PostgresBackgroundChecksMutationLock,
  type BackgroundChecksMutationLock,
} from '../hosted-execution/heartbeat/mutation-lock.js';

export type PostgresPersistence = {
  stores: {
    workspace: DiscoveryWorkspaceStore;
    network: UserNetworkStore;
    informationNetwork:
      InformationNetworkStore & InformationNetworkPublicationStore;
    agent: AgentWakeStore;
    agentJobs: AgentJobStore;
    communication: AgentCommunicationStore;
    conversationHistory: HostedConversationHistoryStore;
    conversationLifecycle: HostedConversationTurnLifecycleStore;
  };
  backgroundChecksMutationLock: BackgroundChecksMutationLock;
  close: () => Promise<void>;
};

export async function createPostgresPersistence(
  config: LucidConfig,
): Promise<PostgresPersistence> {
  const database = new PostgresDatabase({
    url: config.databaseUrl,
    applicationName: 'lucid-server',
  });
  try {
    const workspace = new PostgresDiscoveryWorkspaceStore(database);
    const agent = new PostgresAgentWakeStore(database);
    await agent.initialize();
    const agentJobs = new PostgresAgentJobStore(database);
    await new AgentJobService(agentJobs).ensureInterestDiscoveryJob(
      LOCAL_AGENT_ID,
      config.heartbeatIntervalMs,
    );
    return {
      stores: {
        workspace,
        network: new PostgresUserNetworkStore(database),
        informationNetwork: new PostgresInformationNetworkStore(database),
        agent,
        agentJobs,
        communication: new PostgresAgentCommunicationStore(database),
        conversationHistory: new PostgresHostedConversationHistoryStore(
          database,
        ),
        conversationLifecycle:
          createPostgresHostedConversationTurnLifecycleStore({
            database: database.orm,
          }),
      },
      backgroundChecksMutationLock:
        new PostgresBackgroundChecksMutationLock(
          database,
          config.heartbeatMutationLockTimeoutMs,
        ),
      close: async () => database.close(),
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}
