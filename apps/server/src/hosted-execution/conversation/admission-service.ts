import { createHash, randomUUID } from 'node:crypto';
import type { HostedConversationTurnRunner } from '@roackb2/heddle-adopter/conversation';
import dayjs from 'dayjs';
import { principalHasRole } from '../../auth/request-principal.js';
import { LOCAL_USER_ID } from '../../lucid/local-participant.js';
import type {
  HostedConversationRequest,
  HostedConversationRequestService,
} from './types.js';

export class HostedConversationAuthorizationError extends Error {
  readonly name = 'HostedConversationAuthorizationError';
}

type HostedConversationAdmissionPolicy = {
  tenantId: string;
  productSessionId: string;
  maxTurnMs: number;
};

/**
 * Converts one authenticated Lucid request into provider-neutral turn input.
 *
 * This service owns product admission, stable subject/session identity,
 * invocation identity, and the bounded turn deadline. Authority minting and
 * host invocation remain in the public adopter conversation service.
 */
export class HostedConversationAdmissionService
implements HostedConversationRequestService {
  readonly #policy: Readonly<HostedConversationAdmissionPolicy>;
  readonly #now: () => Date;
  readonly #createInvocationId: () => string;

  constructor(
    private readonly turns: HostedConversationTurnRunner,
    policy: HostedConversationAdmissionPolicy,
    options: {
      now?: () => Date;
      createInvocationId?: () => string;
    } = {},
  ) {
    this.#policy = Object.freeze({ ...policy });
    this.#now = options.now ?? (() => new Date());
    this.#createInvocationId = options.createInvocationId ?? randomUUID;
  }

  async *streamTurn(
    input: HostedConversationRequest,
  ): ReturnType<HostedConversationRequestService['streamTurn']> {
    const subjectId = requireParticipantSubject(input);
    input.signal.throwIfAborted();
    const scope = {
      tenantId: this.#policy.tenantId,
      subjectId,
      productSessionId: this.#policy.productSessionId,
    };

    yield* this.turns.streamTurn({
      scope,
      runtimeSessionId: createRuntimeSessionId(scope),
      invocationId: this.#createInvocationId(),
      prompt: input.prompt,
      deadlineAt: dayjs(this.#now())
        .add(this.#policy.maxTurnMs, 'millisecond')
        .toISOString(),
      signal: input.signal,
    });
  }
}

function requireParticipantSubject(
  input: HostedConversationRequest,
): string {
  if (
    !principalHasRole(input.principal, 'participant')
    || input.principal.participantId !== LOCAL_USER_ID
  ) {
    throw new HostedConversationAuthorizationError(
      'This principal cannot start a hosted Lucid conversation.',
    );
  }
  // The participant ID is Lucid's stable product subject. Authentication
  // adapter labels may change without changing hosted conversation ownership.
  return input.principal.participantId;
}

function createRuntimeSessionId(scope: {
  tenantId: string;
  subjectId: string;
  productSessionId: string;
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      scope.tenantId,
      scope.subjectId,
      scope.productSessionId,
    ]))
    .digest('hex');
  // AgentCore request session IDs allow only alphanumerics and hyphens. Keep
  // the stable product-derived digest while encoding it for that provider
  // boundary rather than leaking a Lucid delimiter into the AWS request.
  return `lucid-runtime-session-${digest}`;
}
