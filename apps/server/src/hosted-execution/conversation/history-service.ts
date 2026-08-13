import type { ExecutionHostStreamEvent } from '@roackb2/heddle-adopter/contracts';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostStreamInterruptedError,
} from '@roackb2/heddle-adopter/http-sse';
import dayjs from 'dayjs';
import omit from 'lodash/omit.js';
import type {
  HostedConversationErrorCode,
  HostedConversationTerminalStatus,
  HostedConversationTurn,
  HostedConversationTurnStore,
} from './store.js';

const RECENT_TURN_LIMIT = 20;
const EXPIRED_TURN_GRACE_MS = 60_000;
const MAX_ANSWER_CHARACTERS = 100_000;
const MODEL_FAILURE_CODE = {
  authentication: 'model_authentication',
  permission: 'model_permission',
  quota: 'model_quota',
  rate_limit: 'model_rate_limit',
  context_window: 'model_context_window',
  request: 'model_request',
  transport: 'model_transport',
  empty_response: 'model_empty_response',
  unknown: 'model_unknown',
} as const;
const RESULT_STATUS = {
  done: 'completed',
  max_steps: 'max_steps',
  error: 'failed',
  interrupted: 'interrupted',
} as const satisfies Record<string, HostedConversationTerminalStatus>;

type TerminalEvent = Extract<
  ExecutionHostStreamEvent,
  { kind: 'result' | 'cancelled' | 'error' }
>;

export interface HostedConversationHistoryReader {
  recentForUser(userId: string): Promise<HostedConversationTurnView[]>;
}

export type HostedConversationTurnView = Omit<
  HostedConversationTurn,
  'workspaceId' | 'userId'
>;

/**
 * Owns Lucid's bounded, user-visible projection of hosted turn lifecycle.
 *
 * The projection deliberately excludes activity, tool payloads, credentials,
 * traces, and thrown error messages. It stores only public terminal output and
 * safe product lifecycle codes.
 */
export class HostedConversationHistoryService
implements HostedConversationHistoryReader {
  readonly #now: () => Date;

  constructor(
    private readonly turns: HostedConversationTurnStore,
    private readonly workspaceId: string,
    options: { now?: () => Date } = {},
  ) {
    this.#now = options.now ?? (() => new Date());
  }

  createTurn(input: {
    invocationId: string;
    userId: string;
    prompt: string;
    deadlineAt: string;
  }): Promise<HostedConversationTurn> {
    const createdAt = this.#now().toISOString();
    return this.turns.createTurn({
      ...input,
      workspaceId: this.workspaceId,
      createdAt,
    });
  }

  recordAccepted(input: {
    invocationId: string;
    userId: string;
    runId: string;
    acceptedAt: string;
  }): Promise<HostedConversationTurn> {
    return this.turns.recordAccepted({
      ...input,
      workspaceId: this.workspaceId,
    });
  }

  recordTerminal(
    userId: string,
    event: TerminalEvent,
  ): Promise<HostedConversationTurn> {
    const settlement = toTerminalSettlement(event);
    return this.turns.settleTurn({
      invocationId: event.invocationId,
      workspaceId: this.workspaceId,
      userId,
      ...settlement,
      settledAt: event.timestamp,
    });
  }

  recordThrownFailure(input: {
    invocationId: string;
    userId: string;
    error: unknown;
    signal: AbortSignal;
  }): Promise<HostedConversationTurn> {
    const interrupted = input.error instanceof ExecutionHostStreamInterruptedError
      || input.signal.aborted
      || input.error instanceof ExecutionHostInvocationCancelledError;
    const settlement: {
      status: HostedConversationTerminalStatus;
      errorCode: HostedConversationErrorCode;
    } = interrupted
      ? { status: 'interrupted', errorCode: 'stream_interrupted' }
      : { status: 'failed', errorCode: 'execution_failed' };
    return this.turns.settleTurn({
      invocationId: input.invocationId,
      workspaceId: this.workspaceId,
      userId: input.userId,
      ...settlement,
      settledAt: this.#now().toISOString(),
    });
  }

  recordAbandoned(input: {
    invocationId: string;
    userId: string;
  }): Promise<HostedConversationTurn> {
    return this.turns.settleTurn({
      invocationId: input.invocationId,
      workspaceId: this.workspaceId,
      userId: input.userId,
      status: 'interrupted',
      errorCode: 'stream_ended_without_terminal',
      settledAt: this.#now().toISOString(),
    });
  }

  async recentForUser(userId: string): Promise<HostedConversationTurnView[]> {
    const now = this.#now();
    await this.turns.interruptExpiredTurns({
      workspaceId: this.workspaceId,
      userId,
      expiredBefore: dayjs(now)
        .subtract(EXPIRED_TURN_GRACE_MS, 'millisecond')
        .toISOString(),
      settledAt: now.toISOString(),
    });
    return (await this.turns.listRecentForUser({
      workspaceId: this.workspaceId,
      userId,
      limit: RECENT_TURN_LIMIT,
    })).map((turn) => omit(turn, ['workspaceId', 'userId']));
  }
}

export function isHostedConversationTerminalEvent(
  event: ExecutionHostStreamEvent,
): event is TerminalEvent {
  return event.kind === 'result'
    || event.kind === 'cancelled'
    || event.kind === 'error';
}

function toTerminalSettlement(event: TerminalEvent): {
  status: HostedConversationTerminalStatus;
  answerMarkdown?: string;
  errorCode?: HostedConversationErrorCode;
} {
  if (event.kind === 'cancelled') {
    return {
      status: 'cancelled',
      errorCode: 'invocation_cancelled',
    };
  }
  if (event.kind === 'error') {
    return {
      status: 'failed',
      errorCode: 'execution_error',
    };
  }

  const answerMarkdown = event.result.summary
    ? event.result.summary.slice(0, MAX_ANSWER_CHARACTERS)
    : undefined;
  return {
    status: RESULT_STATUS[event.result.outcome],
    answerMarkdown,
    errorCode: event.result.outcome === 'error'
      ? event.result.failure
        ? MODEL_FAILURE_CODE[event.result.failure.code]
        : 'execution_result_error'
      : event.result.outcome === 'interrupted'
        ? 'execution_interrupted'
        : undefined,
  };
}
