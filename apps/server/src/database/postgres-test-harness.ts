/** Shared, explicitly destructive PostgreSQL fixture for Lucid tests. */
import { fileURLToPath } from 'node:url';
import { LucidPostgresDatabase } from './postgres-database.js';
import { PostgresDiscoveryRepository } from './postgres-discovery-repository.js';

export const POSTGRES_TEST_DATABASE_URL = requirePostgresTestUrl();
export const POSTGRES_MIGRATIONS_ROOT = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

export type PostgresTestRepository = {
  database: LucidPostgresDatabase;
  repository: PostgresDiscoveryRepository;
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
  const database = new LucidPostgresDatabase({
    url: POSTGRES_TEST_DATABASE_URL,
    applicationName: options.applicationName,
  });
  try {
    await database.migrate(POSTGRES_MIGRATIONS_ROOT);
    const repository = new PostgresDiscoveryRepository(database);
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

function requirePostgresTestUrl(): string {
  const url = process.env.LUCID_POSTGRES_TEST_URL?.trim();
  if (!url) {
    throw new Error(
      'LUCID_POSTGRES_TEST_URL must name a disposable PostgreSQL database before running server tests.',
    );
  }
  return url;
}
