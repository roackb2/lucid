import { fileURLToPath } from 'node:url';
import { LucidSqliteDatabase } from '../database/sqlite-database.js';
import { SqliteDiscoveryRepository } from '../database/sqlite-discovery-repository.js';
import { defineDiscoveryRepositoryContract } from './discovery-repository.test-support.js';

const MIGRATIONS_ROOT = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

defineDiscoveryRepositoryContract({
  name: 'SQLite discovery repository',
  create: async () => {
    const database = new LucidSqliteDatabase(':memory:');
    database.migrate(MIGRATIONS_ROOT);
    const repository = new SqliteDiscoveryRepository(database);
    await repository.initialize();
    return {
      repository,
      close: async () => database.close(),
    };
  },
  // SQLite has one process-local owner, so startup can safely recover every
  // running domain claim. A shared PostgreSQL host must use lease ownership
  // from the released Heddle targeted-run contract instead.
  recoverInterruptedWake: async (repository) => repository.initialize(),
});
