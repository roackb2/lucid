import { z } from 'zod';
import type { RuntimeTurnStreamItem } from '../runtime-session/types.js';

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

export const AgentCoreRuntimeSessionIdSchema = z.string().trim().min(33).max(256);

export const AgentCoreRuntimeScopeSchema = z
  .object({
    adopterId: OpaqueIdSchema,
    tenantId: OpaqueIdSchema,
    userId: OpaqueIdSchema,
    conversationId: OpaqueIdSchema,
  })
  .strict();

export const AgentCoreInvocationSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('conversation-turn'),
    invocationId: OpaqueIdSchema,
    scope: AgentCoreRuntimeScopeSchema,
    prompt: z.string().trim().min(1).max(200_000),
    deadlineAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type AgentCoreInvocation = z.infer<typeof AgentCoreInvocationSchema>;

type AgentCoreStreamEnvelope = {
  schemaVersion: 1;
  invocationId: string;
};

export type AgentCoreStreamEvent =
  | (AgentCoreStreamEnvelope & {
      runId: string;
      sequence: 0;
      timestamp: string;
      kind: 'accepted';
    })
  | (AgentCoreStreamEnvelope & RuntimeTurnStreamItem);

export type AgentCoreApiError = {
  error: {
    code: string;
    message: string;
  };
};

export type AgentCoreHealthResponse = {
  status: 'Healthy' | 'HealthyBusy';
  time_of_last_update: number;
};

export type AgentCoreHttpConfig = {
  mode: 'local' | 'agentcore';
  localTokenSha256?: string;
  keepAliveMs: number;
};

export type AgentCoreHttpLogger = {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
};
