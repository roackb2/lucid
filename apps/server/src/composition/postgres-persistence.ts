/**
 * Builds and owns Lucid's paired PostgreSQL product and heartbeat authorities.
 *
 * Runtime startup never mutates the shared schema. Deployments and local
 * development must run the explicit migration command first.
 */
import type { LucidConfig } from '../config.js';
import type {
  ParticipantNetworkRepository,
} from '../lucid/network/repository.js';
import { PostgresLucidRepository } from '../lucid/persistence/postgres/repository.js';
import type {
  AgentCommunicationRepository,
} from '../lucid/representative/communication/repository.js';
import type {
  RepresentativeWakeRepository,
} from '../lucid/representative/repository.js';
import type {
  DiscoveryWorkspaceRepository,
} from '../lucid/workspace/repository.js';
import { PostgresDatabase } from '../infrastructure/postgres/database.js';
import type {
  RepresentativeHeartbeatTaskAuthority,
} from '../runtime/representative-agent-execution-host.js';
import {
  PostgresHeartbeatTaskStore,
} from '../runtime/heartbeat/postgres/task-store.js';

export type PostgresPersistence = {
  repositories: {
    workspace: DiscoveryWorkspaceRepository;
    network: ParticipantNetworkRepository;
    representative: RepresentativeWakeRepository;
    communication: AgentCommunicationRepository;
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
    const repository = new PostgresLucidRepository(database);
    await repository.initialize();
    return {
      repositories: {
        workspace: repository,
        network: repository,
        representative: repository,
        communication: repository,
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
