import type {
  HostedConversationFailureCode,
  HostedConversationPersistenceScope,
  HostedConversationTurnStatus,
} from '@heddleagent/execution-host-client/conversation';

/** Product-facing history row selected from Heddle's lifecycle authority. */
export type HostedConversationTurnView = {
  invocationId: string;
  prompt: string;
  status: HostedConversationTurnStatus;
  summary: string | null;
  failureCode: HostedConversationFailureCode | null;
  requestedAt: string;
  settledAt: string | null;
};

/** Lucid-owned bounded history query; lifecycle mutations remain in Heddle. */
export interface HostedConversationHistoryStore {
  listRecent(input: {
    scope: HostedConversationPersistenceScope;
    limit: number;
  }): Promise<HostedConversationTurnView[]>;
}
