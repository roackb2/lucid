import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { LucidAuthenticationConfig } from './auth/authenticator.js';

export const LUCID_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

loadDotEnv({ path: join(LUCID_REPO_ROOT, '.env'), quiet: true });

const environmentSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8081),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LUCID_WEB_ORIGIN: z.url().default('http://127.0.0.1:3080'),
  LUCID_WEB_ROOT: z.string().trim().min(1).optional(),
  LUCID_AUTH_MODE: z.enum(['development', 'static-token', 'supabase'])
    .default('development'),
  LUCID_PARTICIPANT_TOKEN: z.string().trim().min(32).optional(),
  LUCID_OPERATOR_TOKEN: z.string().trim().min(32).optional(),
  LUCID_SUPABASE_PROJECT_URL: z.url().optional(),
  LUCID_ALLOW_SELF_ENROLLMENT: z.enum(['true', 'false']).default('false'),
  LUCID_STATE_ROOT: z.string().trim().min(1).optional(),
  LUCID_DATABASE_URL: z.string().trim().min(1),
  LUCID_MODEL: z.string().trim().min(1).default('gpt-5.4-mini'),
  LUCID_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(7),
  LUCID_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .default(15 * 60_000),
  LUCID_HEARTBEAT_POLL_MS: z.coerce
    .number()
    .int()
    .min(250)
    .default(1_000),
  LUCID_HEARTBEAT_MAX_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(16)
    .default(3),
  LUCID_HEARTBEAT_HOST: z.enum(['scheduler', 'targeted']).optional(),
  LUCID_HEARTBEAT_NAMESPACE: z.string().trim().min(1).max(200)
    .default('lucid:representatives'),
  LUCID_HEARTBEAT_EXECUTION_LEASE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(8 * 60 * 60_000)
    .default(20 * 60_000),
  LUCID_HEARTBEAT_RECOVERY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(10 * 60_000)
    .default(60_000),
  LUCID_HEARTBEAT_INVOCATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(15 * 60_000)
    .default(12 * 60_000),
  LUCID_PREFER_API_KEY: z.enum(['true', 'false']).default('false'),
}).superRefine((environment, context) => {
  if (
    environment.LUCID_AUTH_MODE === 'development'
    && !isLoopbackHost(environment.HOST)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_AUTH_MODE'],
      message: 'Development authentication requires a loopback HOST.',
    });
  }
  if (environment.LUCID_AUTH_MODE === 'static-token') {
    if (!environment.LUCID_PARTICIPANT_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_PARTICIPANT_TOKEN'],
        message: 'LUCID_PARTICIPANT_TOKEN is required in static-token mode.',
      });
    }
    if (!environment.LUCID_OPERATOR_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_OPERATOR_TOKEN'],
        message: 'LUCID_OPERATOR_TOKEN is required in static-token mode.',
      });
    }
    if (
      environment.LUCID_PARTICIPANT_TOKEN
      && environment.LUCID_OPERATOR_TOKEN
      && environment.LUCID_PARTICIPANT_TOKEN === environment.LUCID_OPERATOR_TOKEN
    ) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_OPERATOR_TOKEN'],
        message: 'Participant and operator tokens must be distinct.',
      });
    }
  }
  if (environment.LUCID_AUTH_MODE === 'supabase') {
    if (!environment.LUCID_SUPABASE_PROJECT_URL) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_SUPABASE_PROJECT_URL'],
        message: 'LUCID_SUPABASE_PROJECT_URL is required in Supabase mode.',
      });
    }
    if (!environment.LUCID_OPERATOR_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['LUCID_OPERATOR_TOKEN'],
        message: 'LUCID_OPERATOR_TOKEN is required as break-glass access.',
      });
    }
  }
  if (
    environment.LUCID_HEARTBEAT_RECOVERY_INTERVAL_MS
    >= environment.LUCID_HEARTBEAT_EXECUTION_LEASE_MS
  ) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HEARTBEAT_RECOVERY_INTERVAL_MS'],
      message: 'Heartbeat recovery interval must be shorter than the execution lease.',
    });
  }
  if (
    environment.LUCID_HEARTBEAT_INVOCATION_TIMEOUT_MS
    >= environment.LUCID_HEARTBEAT_EXECUTION_LEASE_MS
  ) {
    context.addIssue({
      code: 'custom',
      path: ['LUCID_HEARTBEAT_INVOCATION_TIMEOUT_MS'],
      message: 'Heartbeat invocation timeout must be shorter than the execution lease.',
    });
  }
});

const environment = environmentSchema.parse(process.env);

export type LucidConfig = {
  host: string;
  port: number;
  logLevel: string;
  webOrigin: string;
  webRoot?: string;
  authentication: LucidAuthenticationConfig;
  repoRoot: string;
  stateRoot: string;
  databaseUrl: string;
  heddleStateRoot: string;
  model: string;
  maxSteps: number;
  heartbeatIntervalMs: number;
  heartbeatPollMs: number;
  heartbeatMaxConcurrency: number;
  heartbeatHost: 'scheduler' | 'targeted';
  heartbeatNamespace: string;
  heartbeatExecutionLeaseMs: number;
  heartbeatRecoveryIntervalMs: number;
  heartbeatInvocationTimeoutMs: number;
  preferApiKey: boolean;
};

export function resolveLucidConfig(): LucidConfig {
  const stateRoot = resolve(
    environment.LUCID_STATE_ROOT ?? join(LUCID_REPO_ROOT, 'local', 'discovery-home'),
  );
  const authentication = resolveAuthenticationConfig(environment);

  return {
    host: environment.HOST,
    port: environment.PORT,
    logLevel: environment.LOG_LEVEL,
    webOrigin: environment.LUCID_WEB_ORIGIN,
    webRoot: environment.LUCID_WEB_ROOT
      ? resolve(environment.LUCID_WEB_ROOT)
      : undefined,
    authentication,
    repoRoot: LUCID_REPO_ROOT,
    stateRoot,
    databaseUrl: environment.LUCID_DATABASE_URL,
    heddleStateRoot: join(stateRoot, 'heddle'),
    model: environment.LUCID_MODEL,
    maxSteps: environment.LUCID_MAX_STEPS,
    heartbeatIntervalMs: environment.LUCID_HEARTBEAT_INTERVAL_MS,
    heartbeatPollMs: environment.LUCID_HEARTBEAT_POLL_MS,
    heartbeatMaxConcurrency: environment.LUCID_HEARTBEAT_MAX_CONCURRENCY,
    heartbeatHost: environment.LUCID_HEARTBEAT_HOST ?? 'targeted',
    heartbeatNamespace: environment.LUCID_HEARTBEAT_NAMESPACE,
    heartbeatExecutionLeaseMs:
      environment.LUCID_HEARTBEAT_EXECUTION_LEASE_MS,
    heartbeatRecoveryIntervalMs:
      environment.LUCID_HEARTBEAT_RECOVERY_INTERVAL_MS,
    heartbeatInvocationTimeoutMs:
      environment.LUCID_HEARTBEAT_INVOCATION_TIMEOUT_MS,
    preferApiKey: environment.LUCID_PREFER_API_KEY === 'true',
  };
}

function resolveAuthenticationConfig(
  input: z.infer<typeof environmentSchema>,
): LucidAuthenticationConfig {
  if (input.LUCID_AUTH_MODE === 'static-token') {
    return {
      mode: 'static-token',
      participantToken: input.LUCID_PARTICIPANT_TOKEN!,
      operatorToken: input.LUCID_OPERATOR_TOKEN!,
    };
  }
  if (input.LUCID_AUTH_MODE === 'supabase') {
    return {
      mode: 'supabase',
      projectUrl: input.LUCID_SUPABASE_PROJECT_URL!,
      operatorToken: input.LUCID_OPERATOR_TOKEN!,
      allowSelfEnrollment: input.LUCID_ALLOW_SELF_ENROLLMENT === 'true',
    };
  }
  return { mode: 'development' };
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}
