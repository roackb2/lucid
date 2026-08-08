/**
 * Builds and owns Lucid's paired PostgreSQL product and heartbeat authorities.
 *
 * Runtime startup never mutates the shared schema. Deployments and local
 * development must run the explicit migration command first.
 */
import type { LucidConfig } from '../config.js';
import type { DiscoveryRepository } from '../lucid/discovery-repository.js';
import type {
  RepresentativeHeartbeatTaskAuthority,
} from '../runtime/representative-agent-execution-host.js';
import { LucidPostgresDatabase } from './postgres-database.js';
import { PostgresDiscoveryRepository } from './postgres-discovery-repository.js';
import { PostgresHeartbeatTaskStore } from './postgres-heartbeat-task-store.js';

export type DiscoveryPersistence = {
  repository: DiscoveryRepository;
  taskAuthority: RepresentativeHeartbeatTaskAuthority;
  close: () => Promise<void>;
};

export async function createDiscoveryPersistence(
  config: LucidConfig,
): Promise<DiscoveryPersistence> {
  const database = new LucidPostgresDatabase({
    url: config.databaseUrl,
    applicationName: 'lucid-server',
  });
  try {
    const repository = new PostgresDiscoveryRepository(database);
    await repository.initialize();
    return {
      repository,
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
