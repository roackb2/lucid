import {
  HostedConversationHistoryService,
} from './history-service.js';
import type {
  HostedConversationTurn,
  HostedConversationTurnStore,
} from './store.js';

export class MemoryHostedConversationTurnStore
implements HostedConversationTurnStore {
  readonly turns = new Map<string, HostedConversationTurn>();
  readonly operations: string[] = [];

  async createTurn(
    input: Parameters<HostedConversationTurnStore['createTurn']>[0],
  ): Promise<HostedConversationTurn> {
    this.operations.push(`create:${input.invocationId}`);
    const turn: HostedConversationTurn = {
      ...input,
      status: 'requested',
      runId: null,
      answerMarkdown: null,
      errorCode: null,
      acceptedAt: null,
      settledAt: null,
      updatedAt: input.createdAt,
    };
    this.turns.set(input.invocationId, turn);
    return turn;
  }

  async recordAccepted(
    input: Parameters<HostedConversationTurnStore['recordAccepted']>[0],
  ): Promise<HostedConversationTurn> {
    this.operations.push(`accepted:${input.invocationId}`);
    const current = this.requireTurn(input.invocationId);
    const turn: HostedConversationTurn = {
      ...current,
      status: 'running',
      runId: input.runId,
      acceptedAt: input.acceptedAt,
      updatedAt: input.acceptedAt,
    };
    this.turns.set(input.invocationId, turn);
    return turn;
  }

  async settleTurn(
    input: Parameters<HostedConversationTurnStore['settleTurn']>[0],
  ): Promise<HostedConversationTurn> {
    this.operations.push(`settled:${input.invocationId}:${input.status}`);
    const current = this.requireTurn(input.invocationId);
    const turn: HostedConversationTurn = {
      ...current,
      status: input.status,
      answerMarkdown: input.answerMarkdown ?? null,
      errorCode: input.errorCode ?? null,
      settledAt: input.settledAt,
      updatedAt: input.settledAt,
    };
    this.turns.set(input.invocationId, turn);
    return turn;
  }

  async interruptExpiredTurns(
    input: Parameters<HostedConversationTurnStore['interruptExpiredTurns']>[0],
  ): Promise<void> {
    this.operations.push(`expire:${input.userId}`);
    for (const [invocationId, turn] of this.turns) {
      if (
        turn.workspaceId === input.workspaceId
        && turn.userId === input.userId
        && ['requested', 'running'].includes(turn.status)
        && turn.deadlineAt < input.expiredBefore
      ) {
        this.turns.set(invocationId, {
          ...turn,
          status: 'interrupted',
          errorCode: 'execution_deadline_elapsed',
          settledAt: input.settledAt,
          updatedAt: input.settledAt,
        });
      }
    }
  }

  async listRecentForUser(
    input: Parameters<HostedConversationTurnStore['listRecentForUser']>[0],
  ): Promise<HostedConversationTurn[]> {
    this.operations.push(`list:${input.userId}:${input.limit}`);
    return [...this.turns.values()]
      .filter((turn) => (
        turn.workspaceId === input.workspaceId
        && turn.userId === input.userId
      ))
      .sort((left, right) => (
        right.createdAt.localeCompare(left.createdAt)
        || right.invocationId.localeCompare(left.invocationId)
      ))
      .slice(0, input.limit);
  }

  private requireTurn(invocationId: string): HostedConversationTurn {
    const turn = this.turns.get(invocationId);
    if (!turn) {
      throw new Error(`Missing test conversation turn: ${invocationId}`);
    }
    return turn;
  }
}

export function createTestConversationHistory(input: {
  store?: MemoryHostedConversationTurnStore;
  now?: () => Date;
  workspaceId?: string;
} = {}): {
  history: HostedConversationHistoryService;
  store: MemoryHostedConversationTurnStore;
} {
  const store = input.store ?? new MemoryHostedConversationTurnStore();
  return {
    store,
    history: new HostedConversationHistoryService(
      store,
      input.workspaceId ?? 'local-discovery-workspace',
      { now: input.now },
    ),
  };
}
