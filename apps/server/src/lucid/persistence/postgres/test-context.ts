/** Explicitly destructive Lucid product-state fixture for store tests. */
import {
  createPostgresTestDatabase,
} from '../../../infrastructure/postgres/test-database.js';
import type { PostgresDatabase } from '../../../infrastructure/postgres/database.js';
import { PostgresParticipantNetworkStore } from '../../network/postgres-store.js';
import {
  PostgresAgentCommunicationStore,
} from '../../representative/communication/postgres-store.js';
import { PostgresRepresentativeWakeStore } from '../../representative/postgres-store.js';
import { PostgresDiscoveryWorkspaceStore } from '../../workspace/postgres-store.js';

export type PostgresTestStores = {
  database: PostgresDatabase;
  stores: {
    workspace: PostgresDiscoveryWorkspaceStore;
    network: PostgresParticipantNetworkStore;
    representative: PostgresRepresentativeWakeStore;
    communication: PostgresAgentCommunicationStore;
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
    const representative = new PostgresRepresentativeWakeStore(database);
    await representative.initialize();
    if (options.reset ?? true) {
      await representative.reset({ backgroundChecksEnabled: true });
    }
    const stores = {
      workspace,
      network: new PostgresParticipantNetworkStore(database),
      representative,
      communication: new PostgresAgentCommunicationStore(database),
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
