import type {
  ExecutionHostStreamEvent,
  ExecutionScope,
} from '@roackb2/heddle-adopter/contracts';
import type { LucidRequestPrincipal } from '../../auth/request-principal.js';

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

/** Narrow collaborator used after Lucid has admitted a product request. */
export interface HostedConversationTurnRunner {
  streamTurn(
    input: HostedConversationTurnInput,
  ): AsyncIterable<ExecutionHostStreamEvent>;
}

export type HostedConversationRequest = {
  principal: LucidRequestPrincipal;
  prompt: string;
  signal: AbortSignal;
};

/** Application-facing port used by Lucid's authenticated HTTP boundary. */
export interface HostedConversationRequestService {
  streamTurn(
    input: HostedConversationRequest,
  ): AsyncIterable<ExecutionHostStreamEvent>;
}

/** Resolves model authority without exposing it to routes or product data. */
export interface HostedConversationModelCredentialProvider {
  resolveModelApiKey(
    context: HostedConversationCredentialContext,
  ): Promise<string>;
}

export type HostedConversationEvent = ExecutionHostStreamEvent;
