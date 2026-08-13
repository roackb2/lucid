/** PostgreSQL adapter for Lucid's durable hosted conversation projection. */
import {
  and,
  desc,
  eq,
  inArray,
  lt,
} from 'drizzle-orm';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import {
  postgresHostedConversationTurns as hostedConversationTurns,
} from '../../lucid/persistence/postgres/schema.js';
import type {
  HostedConversationErrorCode,
  HostedConversationTerminalStatus,
  HostedConversationTurn,
  HostedConversationTurnStore,
} from './store.js';

type HostedConversationTurnRow =
  typeof hostedConversationTurns.$inferSelect;

export class PostgresHostedConversationTurnStore
implements HostedConversationTurnStore {
  constructor(private readonly database: PostgresDatabase) {}

  async createTurn(
    input: Parameters<HostedConversationTurnStore['createTurn']>[0],
  ): Promise<HostedConversationTurn> {
    const [inserted] = await this.database.orm
      .insert(hostedConversationTurns)
      .values({
        ...input,
        status: 'requested',
        updatedAt: input.createdAt,
      })
      .onConflictDoNothing({ target: hostedConversationTurns.invocationId })
      .returning();
    if (inserted) {
      return inserted;
    }

    throw new Error(
      `Hosted conversation invocation already exists: ${input.invocationId}`,
    );
  }

  async recordAccepted(
    input: Parameters<HostedConversationTurnStore['recordAccepted']>[0],
  ): Promise<HostedConversationTurn> {
    const [updated] = await this.database.orm
      .update(hostedConversationTurns)
      .set({
        status: 'running',
        runId: input.runId,
        acceptedAt: input.acceptedAt,
        updatedAt: input.acceptedAt,
      })
      .where(and(
        eq(hostedConversationTurns.invocationId, input.invocationId),
        eq(hostedConversationTurns.workspaceId, input.workspaceId),
        eq(hostedConversationTurns.userId, input.userId),
        eq(hostedConversationTurns.status, 'requested'),
      ))
      .returning();
    if (updated) {
      return updated;
    }

    const existing = await this.findScopedTurn(input);
    if (existing?.status === 'running' && existing.runId === input.runId) {
      return existing;
    }
    throw invalidTransition(input.invocationId, 'running');
  }

  async settleTurn(
    input: Parameters<HostedConversationTurnStore['settleTurn']>[0],
  ): Promise<HostedConversationTurn> {
    const [updated] = await this.database.orm
      .update(hostedConversationTurns)
      .set({
        status: input.status,
        answerMarkdown: input.answerMarkdown,
        errorCode: input.errorCode,
        settledAt: input.settledAt,
        updatedAt: input.settledAt,
      })
      .where(and(
        eq(hostedConversationTurns.invocationId, input.invocationId),
        eq(hostedConversationTurns.workspaceId, input.workspaceId),
        eq(hostedConversationTurns.userId, input.userId),
        inArray(hostedConversationTurns.status, ['requested', 'running']),
      ))
      .returning();
    if (updated) {
      return updated;
    }

    const existing = await this.findScopedTurn(input);
    if (isSameSettlement(existing, input)) {
      return existing;
    }
    throw invalidTransition(input.invocationId, input.status);
  }

  async interruptExpiredTurns(
    input: Parameters<HostedConversationTurnStore['interruptExpiredTurns']>[0],
  ): Promise<void> {
    await this.database.orm
      .update(hostedConversationTurns)
      .set({
        status: 'interrupted',
        errorCode: 'execution_deadline_elapsed',
        settledAt: input.settledAt,
        updatedAt: input.settledAt,
      })
      .where(and(
        eq(hostedConversationTurns.workspaceId, input.workspaceId),
        eq(hostedConversationTurns.userId, input.userId),
        inArray(hostedConversationTurns.status, ['requested', 'running']),
        lt(hostedConversationTurns.deadlineAt, input.expiredBefore),
      ));
  }

  async listRecentForUser(
    input: Parameters<HostedConversationTurnStore['listRecentForUser']>[0],
  ): Promise<HostedConversationTurn[]> {
    return (await this.database.orm
      .select()
      .from(hostedConversationTurns)
      .where(and(
        eq(hostedConversationTurns.workspaceId, input.workspaceId),
        eq(hostedConversationTurns.userId, input.userId),
      ))
      .orderBy(
        desc(hostedConversationTurns.createdAt),
        desc(hostedConversationTurns.invocationId),
      )
      .limit(input.limit));
  }

  private async findScopedTurn(input: {
    invocationId: string;
    workspaceId: string;
    userId: string;
  }): Promise<HostedConversationTurnRow | undefined> {
    const [row] = await this.database.orm
      .select()
      .from(hostedConversationTurns)
      .where(and(
        eq(hostedConversationTurns.invocationId, input.invocationId),
        eq(hostedConversationTurns.workspaceId, input.workspaceId),
        eq(hostedConversationTurns.userId, input.userId),
      ))
      .limit(1);
    return row;
  }

}

function isSameSettlement(
  existing: HostedConversationTurnRow | undefined,
  input: {
    status: HostedConversationTerminalStatus;
    answerMarkdown?: string;
    errorCode?: HostedConversationErrorCode;
  },
): existing is HostedConversationTurnRow {
  return existing?.status === input.status
    && existing.answerMarkdown === (input.answerMarkdown ?? null)
    && existing.errorCode === (input.errorCode ?? null);
}

function invalidTransition(
  invocationId: string,
  targetStatus: string,
): Error {
  return new Error(
    `Hosted conversation ${invocationId} cannot transition to ${targetStatus}.`,
  );
}
