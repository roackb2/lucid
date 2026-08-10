import type {
  ExecutionHostStreamEvent,
} from '@roackb2/heddle-adopter/contracts';
import type { LucidRequestPrincipal } from '../../auth/request-principal.js';

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
