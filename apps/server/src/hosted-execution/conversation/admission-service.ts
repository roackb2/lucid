import { createHash, randomUUID } from 'node:crypto';
import type { ExecutionHostStreamEvent } from '@roackb2/heddle-adopter/contracts';
import type { HostedConversationTurnRunner } from '@roackb2/heddle-adopter/conversation';
import dayjs from 'dayjs';
import { principalHasRole } from '../../auth/request-principal.js';
import type {
  HostedConversationRequest,
  HostedConversationRequestService,
} from './types.js';
import {
  HostedConversationHistoryService,
  isHostedConversationTerminalEvent,
} from './history-service.js';

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
    private readonly history: HostedConversationHistoryService,
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
    await this.history.createTurn({
      invocationId,
      userId: subjectId,
      prompt: input.prompt,
      deadlineAt,
    });

    let settled = false;
    try {
      input.signal.throwIfAborted();
      for await (const event of this.turns.streamTurn({
        scope,
        runtimeSessionId: createRuntimeSessionId(scope),
        invocationId,
        prompt: input.prompt,
        deadlineAt,
        signal: input.signal,
      })) {
        let publicEvent: ExecutionHostStreamEvent = event;
        if (event.kind === 'accepted') {
          await this.history.recordAccepted({
            invocationId,
            userId: subjectId,
            runId: event.runId,
            acceptedAt: event.timestamp,
          });
        } else if (isHostedConversationTerminalEvent(event)) {
          const durableTurn = await this.history.recordTerminal(subjectId, event);
          if (event.kind === 'result') {
            publicEvent = {
              ...event,
              result: {
                ...event.result,
                summary: durableTurn.answerMarkdown ?? undefined,
              },
            };
          }
          settled = true;
        }
        yield publicEvent;
      }
      if (!settled) {
        settled = true;
        await this.history.recordAbandoned({
          invocationId,
          userId: subjectId,
        });
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        await this.history.recordThrownFailure({
          invocationId,
          userId: subjectId,
          error,
          signal: input.signal,
        });
      }
      throw error;
    } finally {
      // A downstream disconnect closes the async iterator without throwing
      // through the loop. Settle before releasing the managed stream.
      if (!settled) {
        settled = true;
        await this.history.recordAbandoned({
          invocationId,
          userId: subjectId,
        });
      }
    }
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
