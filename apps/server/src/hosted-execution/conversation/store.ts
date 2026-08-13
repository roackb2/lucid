/** Product-owned persistence port for durable hosted conversation turns. */

export const HOSTED_CONVERSATION_TURN_STATUSES = [
  'requested',
  'running',
  'completed',
  'max_steps',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export type HostedConversationTurnStatus =
  typeof HOSTED_CONVERSATION_TURN_STATUSES[number];

export type HostedConversationTerminalStatus = Exclude<
  HostedConversationTurnStatus,
  'requested' | 'running'
>;

export const HOSTED_CONVERSATION_ERROR_CODES = [
  'execution_deadline_elapsed',
  'execution_error',
  'execution_failed',
  'execution_interrupted',
  'execution_result_error',
  'invocation_cancelled',
  'model_authentication',
  'model_context_window',
  'model_empty_response',
  'model_permission',
  'model_quota',
  'model_rate_limit',
  'model_request',
  'model_transport',
  'model_unknown',
  'stream_ended_without_terminal',
  'stream_interrupted',
] as const;

export type HostedConversationErrorCode =
  typeof HOSTED_CONVERSATION_ERROR_CODES[number];

export type HostedConversationTurn = {
  invocationId: string;
  workspaceId: string;
  userId: string;
  prompt: string;
  status: HostedConversationTurnStatus;
  runId: string | null;
  answerMarkdown: string | null;
  errorCode: HostedConversationErrorCode | null;
  deadlineAt: string;
  createdAt: string;
  acceptedAt: string | null;
  settledAt: string | null;
  updatedAt: string;
};

export interface HostedConversationTurnStore {
  createTurn(input: {
    invocationId: string;
    workspaceId: string;
    userId: string;
    prompt: string;
    deadlineAt: string;
    createdAt: string;
  }): Promise<HostedConversationTurn>;

  recordAccepted(input: {
    invocationId: string;
    workspaceId: string;
    userId: string;
    runId: string;
    acceptedAt: string;
  }): Promise<HostedConversationTurn>;

  settleTurn(input: {
    invocationId: string;
    workspaceId: string;
    userId: string;
    status: HostedConversationTerminalStatus;
    answerMarkdown?: string;
    errorCode?: HostedConversationErrorCode;
    settledAt: string;
  }): Promise<HostedConversationTurn>;

  interruptExpiredTurns(input: {
    workspaceId: string;
    userId: string;
    expiredBefore: string;
    settledAt: string;
  }): Promise<void>;

  listRecentForUser(input: {
    workspaceId: string;
    userId: string;
    limit: number;
  }): Promise<HostedConversationTurn[]>;
}
