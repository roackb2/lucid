import {
  postgresExecutionHostConversationTurns as turns,
} from '@heddleagent/postgres/execution-host/conversations';
import {
  and,
  desc,
  eq,
} from 'drizzle-orm';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import type {
  HostedConversationHistoryStore,
  HostedConversationTurnView,
} from './store.js';

/** PostgreSQL query adapter for Lucid's bounded user-visible history. */
export class PostgresHostedConversationHistoryStore
implements HostedConversationHistoryStore {
  constructor(private readonly database: PostgresDatabase) {}

  listRecent(
    input: Parameters<HostedConversationHistoryStore['listRecent']>[0],
  ): Promise<HostedConversationTurnView[]> {
    return this.database.orm
      .select({
        invocationId: turns.invocationId,
        prompt: turns.prompt,
        status: turns.status,
        summary: turns.summary,
        failureCode: turns.failureCode,
        requestedAt: turns.requestedAt,
        settledAt: turns.settledAt,
      })
      .from(turns)
      .where(and(
        eq(turns.tenantId, input.scope.tenantId),
        eq(turns.subjectId, input.scope.subjectId),
        eq(turns.productSessionId, input.scope.productSessionId),
      ))
      .orderBy(desc(turns.requestedAt), desc(turns.invocationId))
      .limit(input.limit);
  }
}
