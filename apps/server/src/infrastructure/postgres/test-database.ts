/** Explicit real-PostgreSQL fixture shared by infrastructure adapter tests. */
import { fileURLToPath } from 'node:url';
import { PostgresDatabase } from './database.js';

export const POSTGRES_TEST_DATABASE_URL = requirePostgresTestUrl();
export const POSTGRES_MIGRATIONS_ROOT = fileURLToPath(
  new URL('../../../drizzle', import.meta.url),
);

/** Opens and migrates one pool against the caller-supplied disposable DB. */
export async function createPostgresTestDatabase(options: {
  applicationName: string;
  maxConnections?: number;
}): Promise<PostgresDatabase> {
  const database = new PostgresDatabase({
    url: POSTGRES_TEST_DATABASE_URL,
    applicationName: options.applicationName,
    maxConnections: options.maxConnections,
  });
  try {
    await database.migrate(POSTGRES_MIGRATIONS_ROOT);
    return database;
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
