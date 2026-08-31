/**
 * Cross-process serialization for Lucid-owned heartbeat catalog and admission
 * mutations. The callback may call the remote Coordinator, so both lock
 * acquisition and the callback's HTTP work must be bounded by their owners.
 */
import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';

const BACKGROUND_CHECKS_MUTATION_LOCK =
  'lucid:background-checks:catalog-and-admission';

export interface BackgroundChecksMutationLock {
  runExclusive<Result>(operation: () => Promise<Result>): Promise<Result>;
}

/** Holds one crash-released PostgreSQL advisory lock for the full mutation. */
export class PostgresBackgroundChecksMutationLock
implements BackgroundChecksMutationLock {
  constructor(
    private readonly database: PostgresDatabase,
    private readonly lockTimeoutMs: number,
  ) {
    if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1_000) {
      throw new Error(
        'Background-checks mutation lock timeout must be at least 1000ms.',
      );
    }
  }

  async runExclusive<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    return await this.database.orm.transaction(async (transaction) => {
      await transaction.execute(sql`
        select set_config(
          'lock_timeout',
          ${`${this.lockTimeoutMs}ms`},
          true
        )
      `);
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${BACKGROUND_CHECKS_MUTATION_LOCK}, 0)
        )
      `);
      return await operation();
    });
  }
}
