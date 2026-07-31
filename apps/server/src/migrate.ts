import { LUCID_MIGRATIONS_ROOT, resolveLucidConfig } from './config.js';
import { LucidSqliteDatabase } from './database/sqlite-database.js';

const config = resolveLucidConfig();
const database = new LucidSqliteDatabase(config.databasePath);

try {
  database.migrate(LUCID_MIGRATIONS_ROOT);
  process.stdout.write(`Lucid database migrated at ${config.databasePath}\n`);
} finally {
  database.close();
}
