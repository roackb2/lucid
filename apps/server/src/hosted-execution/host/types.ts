import { z } from 'zod';

const OpaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/,
    'must be an opaque, path-free identifier',
  );

const RuntimeSessionIdSchema = z.string().trim().min(33).max(256);
const TimestampSchema = z.iso.datetime({ offset: true });

const RuntimePublicResultSchema = z.object({
  outcome: z.enum(['done', 'max_steps', 'error', 'interrupted']),
  summary: z.string().optional(),
  failure: z.object({
    source: z.literal('model'),
    code: z.enum([
      'authentication',
      'permission',
      'quota',
      'rate_limit',
      'context_window',
      'request',
      'transport',
      'empty_response',
      'unknown',
    ]),
  }).strict().optional(),
}).strict();
const StreamEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  invocationId: OpaqueIdSchema,
  runId: OpaqueIdSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: TimestampSchema,
});

export const ExecutionHostStreamEventSchema = z.discriminatedUnion('kind', [
  StreamEnvelopeSchema.extend({
    sequence: z.literal(0),
    kind: z.literal('accepted'),
  }).strict(),
  StreamEnvelopeSchema.extend({
    kind: z.literal('activity'),
    activity: z.unknown(),
  }).strict(),
  StreamEnvelopeSchema.extend({
    kind: z.literal('result'),
    result: RuntimePublicResultSchema,
  }).strict(),
  StreamEnvelopeSchema.extend({
    kind: z.literal('cancelled'),
    reason: z.string(),
  }).strict(),
  StreamEnvelopeSchema.extend({
    kind: z.literal('error'),
    error: z.object({
      code: z.string().trim().min(1).max(128),
      message: z.string().trim().min(1).max(1_600),
    }).strict(),
  }).strict(),
]);

export type ExecutionHostStreamEvent = z.infer<
  typeof ExecutionHostStreamEventSchema
>;

export type ExecutionHostConversationTurn = {
  invocationId: string;
  runtimeSessionId: string;
  prompt: string;
  deadlineAt?: string;
  executionAssertion: string;
  mcpCapability?: string;
  modelApiKey: string;
  signal?: AbortSignal;
};

export interface ExecutionHost {
  streamConversationTurn(
    input: ExecutionHostConversationTurn,
  ): AsyncIterable<ExecutionHostStreamEvent>;
}

export const ExecutionHostConversationTurnSchema = z.object({
  invocationId: OpaqueIdSchema,
  runtimeSessionId: RuntimeSessionIdSchema,
  prompt: z.string().trim().min(1).max(200_000),
  deadlineAt: TimestampSchema.optional(),
  executionAssertion: z.string().trim().min(32).max(4_096),
  mcpCapability: z.string().trim().min(32).max(4_096).optional(),
  modelApiKey: z.string().trim().min(8).max(4_096),
  signal: z.custom<AbortSignal>(
    (value) => value instanceof AbortSignal,
    'signal must be an AbortSignal',
  ).optional(),
}).strict();
