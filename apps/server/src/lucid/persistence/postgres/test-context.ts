/** Explicitly destructive Lucid product-state fixture for store tests. */
import {
  createPostgresTestDatabase,
} from '../../../infrastructure/postgres/test-database.js';
import type { PostgresDatabase } from '../../../infrastructure/postgres/database.js';
import { PostgresUserNetworkStore } from '../../network/postgres-store.js';
import {
  PostgresAgentCommunicationStore,
} from '../../agent/communication/postgres-store.js';
import { PostgresAgentWakeStore } from '../../agent/postgres-store.js';
import { PostgresDiscoveryWorkspaceStore } from '../../workspace/postgres-store.js';
import {
  PostgresHostedConversationTurnStore,
} from '../../../hosted-execution/conversation/postgres-store.js';

export type PostgresTestStores = {
  database: PostgresDatabase;
  stores: {
    workspace: PostgresDiscoveryWorkspaceStore;
    network: PostgresUserNetworkStore;
    agent: PostgresAgentWakeStore;
    communication: PostgresAgentCommunicationStore;
    conversation: PostgresHostedConversationTurnStore;
  };
};

/**
 * Opens an isolated test pool and optionally resets all Lucid product rows.
 *
 * The URL must name a disposable database. Tests never fall back to the
 * runtime database URL because store reset is intentionally destructive.
 */
export async function createPostgresTestStores(options: {
  applicationName: string;
  reset?: boolean;
}): Promise<PostgresTestStores> {
  const database = await createPostgresTestDatabase({
    applicationName: options.applicationName,
  });
  try {
    const workspace = new PostgresDiscoveryWorkspaceStore(database);
    const agent = new PostgresAgentWakeStore(database);
    await agent.initialize();
    if (options.reset ?? true) {
      await agent.reset({ backgroundChecksEnabled: true });
    }
    const stores = {
      workspace,
      network: new PostgresUserNetworkStore(database),
      agent,
      communication: new PostgresAgentCommunicationStore(database),
      conversation: new PostgresHostedConversationTurnStore(database),
    };
    return {
      database,
      stores,
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}
