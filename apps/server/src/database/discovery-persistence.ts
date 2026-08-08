/**
 * Builds and owns the concrete persistence resource selected by host config.
 *
 * SQLite remains the zero-setup local default and applies its local migration
 * on startup. PostgreSQL is shared infrastructure: deployments must run the
 * explicit migration command before starting API or worker processes.
 */
import { LUCID_MIGRATIONS_ROOT, type LucidConfig } from '../config.js';
import type { DiscoveryRepository } from '../lucid/discovery-repository.js';
import { LucidPostgresDatabase } from './postgres-database.js';
import { PostgresDiscoveryRepository } from './postgres-discovery-repository.js';
import { LucidSqliteDatabase } from './sqlite-database.js';
import { SqliteDiscoveryRepository } from './sqlite-discovery-repository.js';

export type DiscoveryPersistence = {
  repository: DiscoveryRepository;
  close: () => Promise<void>;
};

export async function createDiscoveryPersistence(
  config: LucidConfig,
): Promise<DiscoveryPersistence> {
  if (config.database.driver === 'postgres') {
    const database = new LucidPostgresDatabase({
      url: config.database.url,
      applicationName: 'lucid-server',
    });
    try {
      const repository = new PostgresDiscoveryRepository(database);
      await repository.initialize();
      return {
        repository,
        close: async () => database.close(),
      };
    } catch (error) {
      await database.close();
      throw error;
    }
  }

  const database = new LucidSqliteDatabase(config.database.path);
  try {
    database.migrate(LUCID_MIGRATIONS_ROOT);
    const repository = new SqliteDiscoveryRepository(database);
    await repository.initialize();
    return {
      repository,
      close: async () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
