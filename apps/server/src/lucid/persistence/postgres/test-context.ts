/** Explicitly destructive Lucid product-state fixture for repository tests. */
import {
  createPostgresTestDatabase,
} from '../../../infrastructure/postgres/test-database.js';
import type { PostgresDatabase } from '../../../infrastructure/postgres/database.js';
import { PostgresLucidRepository } from './repository.js';

export type PostgresTestRepository = {
  database: PostgresDatabase;
  repository: PostgresLucidRepository;
};

/**
 * Opens an isolated test pool and optionally resets all Lucid product rows.
 *
 * The URL must name a disposable database. Tests never fall back to the
 * runtime database URL because repository reset is intentionally destructive.
 */
export async function createPostgresTestRepository(options: {
  applicationName: string;
  reset?: boolean;
}): Promise<PostgresTestRepository> {
  const database = await createPostgresTestDatabase({
    applicationName: options.applicationName,
  });
  try {
    const repository = new PostgresLucidRepository(database);
    await repository.initialize();
    if (options.reset ?? true) {
      await repository.reset({ backgroundChecksEnabled: true });
    }
    return { database, repository };
  } catch (error) {
    await database.close();
    throw error;
  }
}
