import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './db.js';

await migrate(db, {
  migrationsFolder: new URL('../drizzle', import.meta.url).pathname,
});

await sql.end();
process.stdout.write('Lucid TS migrations applied.\n');
