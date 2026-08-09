export type RuntimeScope = {
  adopterId: string;
  tenantId: string;
  userId: string;
  conversationId: string;
};

export type RuntimeTurnRequest = {
  invocationId: string;
  scope: RuntimeScope;
  prompt: string;
  deadlineAt?: string;
};

export type RuntimePublicResult = {
  outcome: 'done' | 'max_steps' | 'error' | 'interrupted';
  summary?: string;
  failure?: {
    source: 'model';
    code:
      | 'authentication'
      | 'permission'
      | 'quota'
      | 'rate_limit'
      | 'context_window'
      | 'request'
      | 'transport'
      | 'empty_response'
      | 'unknown';
  };
};

type RuntimeTurnStreamEnvelope = {
  runId: string;
  sequence: number;
  timestamp: string;
};

/** Ordered execution events exposed by any adapter implementing the turn port. */
export type RuntimeTurnStreamItem =
  | (RuntimeTurnStreamEnvelope & {
    kind: 'activity';
    activity: unknown;
  })
  | (RuntimeTurnStreamEnvelope & {
    kind: 'result';
    result: RuntimePublicResult;
  })
  | (RuntimeTurnStreamEnvelope & {
    kind: 'cancelled';
    reason: string;
  })
  | (RuntimeTurnStreamEnvelope & {
    kind: 'error';
    error: { code: string; message: string };
  });

export type RuntimeInvocationHandle = {
  runId: string;
  acceptedAt: string;
  events(): AsyncIterable<RuntimeTurnStreamItem>;
  cancel(): boolean;
  result: Promise<RuntimePublicResult>;
};

export type RuntimeSessionConfig = {
  maxInvocationMs: number;
};
