/**
 * Builds and owns Lucid's paired PostgreSQL product and heartbeat authorities.
 *
 * Runtime startup never mutates the shared schema. Deployments and local
 * development must run the explicit migration command first.
 */
import type { LucidConfig } from '../config.js';
import { PostgresParticipantNetworkStore } from '../lucid/network/postgres-store.js';
import type { ParticipantNetworkStore } from '../lucid/network/store.js';
import {
  PostgresAgentCommunicationStore,
} from '../lucid/representative/communication/postgres-store.js';
import type {
  AgentCommunicationStore,
} from '../lucid/representative/communication/store.js';
import {
  PostgresRepresentativeWakeStore,
} from '../lucid/representative/postgres-store.js';
import type { RepresentativeWakeStore } from '../lucid/representative/store.js';
import {
  PostgresDiscoveryWorkspaceStore,
} from '../lucid/workspace/postgres-store.js';
import type { DiscoveryWorkspaceStore } from '../lucid/workspace/store.js';
import { PostgresDatabase } from '../infrastructure/postgres/database.js';
import type {
  RepresentativeHeartbeatTaskAuthority,
} from '../runtime/representative-agent-execution-host.js';
import {
  PostgresHeartbeatTaskStore,
} from '../runtime/heartbeat/postgres/task-store.js';

export type PostgresPersistence = {
  stores: {
    workspace: DiscoveryWorkspaceStore;
    network: ParticipantNetworkStore;
    representative: RepresentativeWakeStore;
    communication: AgentCommunicationStore;
  };
  taskAuthority: RepresentativeHeartbeatTaskAuthority;
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
    const representative = new PostgresRepresentativeWakeStore(database);
    await representative.initialize();
    return {
      stores: {
        workspace,
        network: new PostgresParticipantNetworkStore(database),
        representative,
        communication: new PostgresAgentCommunicationStore(database),
      },
      taskAuthority: new PostgresHeartbeatTaskStore({
        database,
        namespace: config.heartbeatNamespace,
        executionLeaseMs: config.heartbeatExecutionLeaseMs,
      }),
      close: async () => database.close(),
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}
