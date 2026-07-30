import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema.js';

/**
 * Owns the single-host SQLite lifecycle and the durability pragmas Lucid
 * relies on. Domain repositories receive the Drizzle handle; they do not
 * configure or close the underlying database themselves.
 */
export class LucidDatabaseService {
  readonly client: BetterSqlite3.Database;
  readonly orm: BetterSQLite3Database<typeof schema>;

  constructor(readonly path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.client = new BetterSqlite3(path);
    this.client.pragma('foreign_keys = ON');
    this.client.pragma('busy_timeout = 5000');
    if (path !== ':memory:') {
      this.client.pragma('journal_mode = WAL');
      this.client.pragma('synchronous = NORMAL');
    }
    this.orm = drizzle(this.client, { schema });
  }

  migrate(migrationsFolder: string): void {
    migrate(this.orm, { migrationsFolder });
  }

  close(): void {
    this.client.close();
  }
}
