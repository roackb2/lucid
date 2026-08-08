/**
 * Owns one PostgreSQL connection pool and the explicit migration lifecycle.
 *
 * Product repositories receive the Drizzle handle. They do not parse database
 * URLs, configure pooling/prepared statements, run migrations, or close the
 * underlying pool. `prepareStatements: false` is compatible with transaction
 * poolers such as Supavisor and is the safe hosted default.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

export type PostgresDatabaseOptions = {
  url: string;
  maxConnections?: number;
  prepareStatements?: boolean;
  applicationName?: string;
};

export class PostgresDatabase {
  readonly client: Sql;
  readonly orm: PostgresJsDatabase;

  constructor(options: PostgresDatabaseOptions) {
    this.client = postgres(options.url, {
      max: options.maxConnections ?? 10,
      prepare: options.prepareStatements ?? false,
      connection: {
        application_name: options.applicationName ?? 'lucid-server',
      },
      onnotice: () => undefined,
    });
    this.orm = drizzle(this.client);
  }

  async migrate(migrationsFolder: string): Promise<void> {
    await migrate(this.orm, {
      migrationsFolder,
      migrationsSchema: 'drizzle',
      migrationsTable: 'lucid_migrations',
    });
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}
