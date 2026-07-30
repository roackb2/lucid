import { LUCID_MIGRATIONS_ROOT, resolveLucidConfig } from './config.js';
import { LucidDatabaseService } from './database/service.js';

const config = resolveLucidConfig();
const database = new LucidDatabaseService(config.databasePath);

try {
  database.migrate(LUCID_MIGRATIONS_ROOT);
  process.stdout.write(`Lucid database migrated at ${config.databasePath}\n`);
} finally {
  database.close();
}
