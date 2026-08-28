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

export type PostgresPersistence = {
  stores: {
    workspace: DiscoveryWorkspaceStore;
    network: UserNetworkStore;
    agent: AgentWakeStore;
    communication: AgentCommunicationStore;
    conversationHistory: HostedConversationHistoryStore;
    conversationLifecycle: HostedConversationTurnLifecycleStore;
  };
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
    return {
      stores: {
        workspace,
        network: new PostgresUserNetworkStore(database),
        agent,
        communication: new PostgresAgentCommunicationStore(database),
        conversationHistory: new PostgresHostedConversationHistoryStore(
          database,
        ),
        conversationLifecycle:
          createPostgresHostedConversationTurnLifecycleStore({
            database: database.orm,
          }),
      },
      close: async () => database.close(),
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}
