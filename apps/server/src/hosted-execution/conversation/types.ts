import type {
  ExecutionHostStreamEvent,
  ExecutionScope,
} from '@roackb2/heddle-adopter/contracts';

export type HostedConversationTurnInput = {
  scope: Omit<ExecutionScope, 'adopterId'>;
  runtimeSessionId: string;
  invocationId: string;
  prompt: string;
  deadlineAt?: string;
  signal?: AbortSignal;
};

export type HostedConversationCredentialContext = Pick<
  HostedConversationTurnInput,
  'scope' | 'invocationId' | 'signal'
>;

/** Resolves model authority without exposing it to routes or product data. */
export interface HostedConversationModelCredentialProvider {
  resolveModelApiKey(
    context: HostedConversationCredentialContext,
  ): Promise<string>;
}

export type HostedConversationEvent = ExecutionHostStreamEvent;
