import { randomUUID } from 'node:crypto';
import type { HostedConversationTurnRunner } from '@heddleagent/execution-host-client/conversation';
import dayjs from 'dayjs';
import { principalHasRole } from '../../auth/request-principal.js';
import type {
  HostedConversationRequest,
  HostedConversationRequestService,
} from './types.js';
import { createHostedRuntimeSessionId } from '../runtime-session-id.js';

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
    const subjectId = requireUserSubject(input);
    input.signal.throwIfAborted();
    const invocationId = this.#createInvocationId();
    const deadlineAt = dayjs(this.#now())
      .add(this.#policy.maxTurnMs, 'millisecond')
      .toISOString();
    const scope = {
      tenantId: this.#policy.tenantId,
      subjectId,
      productSessionId: this.#policy.productSessionId,
    };
    yield* this.turns.streamTurn({
      scope,
      runtimeSessionId: createHostedRuntimeSessionId(scope),
      invocationId,
      prompt: input.prompt,
      deadlineAt,
      signal: input.signal,
    });
  }
}

function requireUserSubject(
  input: HostedConversationRequest,
): string {
  if (
    !principalHasRole(input.principal, 'user')
    || !input.principal.userId
  ) {
    throw new HostedConversationAuthorizationError(
      'This principal cannot start a hosted Lucid conversation.',
    );
  }
  // The user ID is Lucid's stable product subject. Authentication
  // adapter labels may change without changing hosted conversation ownership.
  return input.principal.userId;
}
