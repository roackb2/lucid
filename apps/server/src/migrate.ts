/**
 * Explicit PostgreSQL migration entrypoint for hosted provisioning and CI.
 *
 * Runtime startup does not silently mutate a shared database. Operators run
 * this command as a separate release step with LUCID_DATABASE_URL configured.
 */
import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { LucidPostgresDatabase } from './database/postgres-database.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
loadDotEnv({ path: join(repoRoot, '.env'), quiet: true });

const environment = z.object({
  LUCID_DATABASE_URL: z.string().trim().min(1),
}).parse(process.env);
const migrationsRoot = fileURLToPath(
  new URL('../drizzle', import.meta.url),
);
const database = new LucidPostgresDatabase({
  url: environment.LUCID_DATABASE_URL,
  maxConnections: 1,
  applicationName: 'lucid-postgres-migrator',
});

try {
  await database.migrate(migrationsRoot);
  process.stdout.write('Lucid PostgreSQL migrations completed.\n');
} finally {
  await database.close();
}
