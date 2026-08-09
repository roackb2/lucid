import { resolve } from 'node:path';
import { z } from 'zod';
import type { RuntimeConfig } from './types.js';

const PLAINTEXT_LOCAL_TOKEN_ENV = 'LUCID_AGENT_RUNTIME_LOCAL_TOKEN';
const LocalTokenDigestSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{64}$/)
  .transform((value) => value.toLowerCase());

const RuntimeConfigEnvironmentSchema = z.object({
  LUCID_AGENT_RUNTIME_MODE: z.enum(['local', 'agentcore']).default('local'),
  LUCID_AGENT_RUNTIME_ISOLATED: z.enum(['true', 'false']).default('false'),
  LUCID_AGENT_RUNTIME_LOCAL_TOKEN_SHA256: LocalTokenDigestSchema.optional(),
  LUCID_AGENT_RUNTIME_MODEL: z.string().trim().min(1).default('gpt-5.4'),
  LUCID_AGENT_RUNTIME_WORKSPACE_ROOT: z.string().trim().min(1).default('/workspace'),
  LUCID_AGENT_RUNTIME_STATE_ROOT: z.string().trim().min(1).default('/runtime/state'),
  LUCID_AGENT_RUNTIME_MAX_STEPS: z.coerce.number().int().min(1).max(128).default(32),
  LUCID_AGENT_RUNTIME_MAX_INVOCATION_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60 * 60_000)
    .default(15 * 60_000),
  LUCID_AGENT_RUNTIME_KEEP_ALIVE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(15_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const FORBIDDEN_AMBIENT_SECRET_NAMES = [
  'OPENAI_API_KEY',
  'PERSONAL_OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'PERSONAL_ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'LUCID_DATABASE_URL',
  'SUPABASE_DB_URL',
  'PGPASSWORD',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const;

/**
 * Validates that the process receives only a one-way verifier for local
 * ingress. Model credentials arrive per invocation and never enter process.env.
 */
export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  assertNoAmbientServiceSecrets(environment);
  if (environment[PLAINTEXT_LOCAL_TOKEN_ENV]?.trim()) {
    throw new Error(
      'Agent runtime refuses a plaintext local token in its environment. Configure LUCID_AGENT_RUNTIME_LOCAL_TOKEN_SHA256 instead.',
    );
  }
  const parsed = RuntimeConfigEnvironmentSchema.parse(environment);

  if (parsed.LUCID_AGENT_RUNTIME_MODE === 'local') {
    if (parsed.LUCID_AGENT_RUNTIME_ISOLATED !== 'true') {
      throw new Error(
        'Local workstation mode requires LUCID_AGENT_RUNTIME_ISOLATED=true and must run inside a dedicated container.',
      );
    }
    if (!parsed.LUCID_AGENT_RUNTIME_LOCAL_TOKEN_SHA256) {
      throw new Error(
        'Local runtime authentication requires LUCID_AGENT_RUNTIME_LOCAL_TOKEN_SHA256.',
      );
    }
  }

  return {
    mode: parsed.LUCID_AGENT_RUNTIME_MODE,
    host: '0.0.0.0',
    port: 8080,
    localTokenSha256: parsed.LUCID_AGENT_RUNTIME_LOCAL_TOKEN_SHA256,
    model: parsed.LUCID_AGENT_RUNTIME_MODEL,
    workspaceRoot: resolve(parsed.LUCID_AGENT_RUNTIME_WORKSPACE_ROOT),
    stateRoot: resolve(parsed.LUCID_AGENT_RUNTIME_STATE_ROOT),
    maxSteps: parsed.LUCID_AGENT_RUNTIME_MAX_STEPS,
    maxInvocationMs: parsed.LUCID_AGENT_RUNTIME_MAX_INVOCATION_MS,
    keepAliveMs: parsed.LUCID_AGENT_RUNTIME_KEEP_ALIVE_MS,
    logLevel: parsed.LOG_LEVEL,
  };
}

function assertNoAmbientServiceSecrets(environment: NodeJS.ProcessEnv): void {
  const forbidden = FORBIDDEN_AMBIENT_SECRET_NAMES.filter(
    (name) => typeof environment[name] === 'string' && environment[name]?.trim(),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `Agent runtime refuses ambient service credentials: ${forbidden.join(', ')}. Supply the model credential through the invocation header instead.`,
    );
  }
}
