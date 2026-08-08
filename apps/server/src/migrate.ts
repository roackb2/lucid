import { LUCID_MIGRATIONS_ROOT, resolveLucidConfig } from './config.js';
import { LucidSqliteDatabase } from './database/sqlite-database.js';

const config = resolveLucidConfig();
if (config.database.driver !== 'sqlite') {
  throw new Error(
    'The SQLite migration command requires LUCID_DATABASE_DRIVER=sqlite. Use db:migrate:postgres for PostgreSQL.',
  );
}
const database = new LucidSqliteDatabase(config.database.path);

try {
  database.migrate(LUCID_MIGRATIONS_ROOT);
  process.stdout.write(`Lucid database migrated at ${config.database.path}\n`);
} finally {
  database.close();
}
