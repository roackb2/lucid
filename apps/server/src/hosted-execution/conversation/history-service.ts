import {
  interruptExpiredHostedConversationTurns,
  type HostedConversationPersistenceScope,
  type HostedConversationTurnLifecycleStore,
} from '@heddleagent/execution-host-client/conversation';
import type {
  HostedConversationHistoryStore,
  HostedConversationTurnView,
} from './store.js';

const RECENT_TURN_LIMIT = 20;

export interface HostedConversationHistoryReader {
  recentForUser(userId: string): Promise<HostedConversationTurnView[]>;
}

type HostedConversationHistoryScope = Omit<
  HostedConversationPersistenceScope,
  'subjectId'
>;

/** Owns Lucid's bounded, authenticated query over Heddle lifecycle records. */
export class HostedConversationHistoryService
implements HostedConversationHistoryReader {
  readonly #scope: Readonly<HostedConversationHistoryScope>;
  readonly #now: () => Date;

  constructor(
    private readonly history: HostedConversationHistoryStore,
    private readonly lifecycle: HostedConversationTurnLifecycleStore,
    scope: HostedConversationHistoryScope,
    options: { now?: () => Date } = {},
  ) {
    this.#scope = Object.freeze({ ...scope });
    this.#now = options.now ?? (() => new Date());
  }

  async recentForUser(userId: string): Promise<HostedConversationTurnView[]> {
    const scope = { ...this.#scope, subjectId: userId };
    await interruptExpiredHostedConversationTurns(this.lifecycle, scope, {
      now: this.#now,
    });
    return this.history.listRecent({ scope, limit: RECENT_TURN_LIMIT });
  }
}

export type { HostedConversationTurnView } from './store.js';
