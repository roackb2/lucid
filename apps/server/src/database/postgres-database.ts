/**
 * Owns one PostgreSQL connection pool and Lucid migration lifecycle.
 *
 * Product repositories receive the Drizzle handle. They do not parse database
 * URLs, configure pooling/prepared statements, run migrations, or close the
 * underlying pool. `prepareStatements: false` is compatible with transaction
 * poolers such as Supavisor and is the safe hosted default.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import * as schema from './postgres-schema.js';

export type LucidPostgresDatabaseOptions = {
  url: string;
  maxConnections?: number;
  prepareStatements?: boolean;
  applicationName?: string;
};

export class LucidPostgresDatabase {
  readonly client: Sql;
  readonly orm: PostgresJsDatabase<typeof schema>;

  constructor(options: LucidPostgresDatabaseOptions) {
    this.client = postgres(options.url, {
      max: options.maxConnections ?? 10,
      prepare: options.prepareStatements ?? false,
      connection: {
        application_name: options.applicationName ?? 'lucid-server',
      },
      onnotice: () => undefined,
    });
    this.orm = drizzle(this.client, { schema });
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
