import { z } from 'zod';

export const AGENTCORE_RUNTIME_SESSION_HEADER =
  'x-amzn-bedrock-agentcore-runtime-session-id';
export const LOCAL_RUNTIME_TOKEN_HEADER = 'x-lucid-local-runtime-token';
export const MODEL_API_KEY_HEADER = 'x-lucid-model-api-key';

const OpaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/, 'must be an opaque, path-free identifier');

export const RuntimeSessionIdSchema = z.string().trim().min(33).max(256);

export const RuntimeScopeSchema = z
  .object({
    adopterId: OpaqueIdSchema,
    tenantId: OpaqueIdSchema,
    userId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
  })
  .strict();

export const RuntimeInvocationSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('conversation-turn'),
    invocationId: OpaqueIdSchema,
    scope: RuntimeScopeSchema,
    prompt: z.string().trim().min(1).max(200_000),
    deadlineAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type RuntimeScope = z.infer<typeof RuntimeScopeSchema>;
export type RuntimeInvocation = z.infer<typeof RuntimeInvocationSchema>;

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

export type RuntimeStreamEvent =
  | {
      schemaVersion: 1;
      invocationId: string;
      runId: string;
      sequence: 0;
      timestamp: string;
      kind: 'accepted';
    }
  | {
      schemaVersion: 1;
      invocationId: string;
      runId: string;
      sequence: number;
      timestamp: string;
      kind: 'activity';
      activity: unknown;
    }
  | {
      schemaVersion: 1;
      invocationId: string;
      runId: string;
      sequence: number;
      timestamp: string;
      kind: 'result';
      result: RuntimePublicResult;
    }
  | {
      schemaVersion: 1;
      invocationId: string;
      runId: string;
      sequence: number;
      timestamp: string;
      kind: 'cancelled';
      reason: string;
    }
  | {
      schemaVersion: 1;
      invocationId: string;
      runId: string;
      sequence: number;
      timestamp: string;
      kind: 'error';
      error: { code: string; message: string };
    };

export type RuntimeApiError = {
  error: {
    code: string;
    message: string;
  };
};
