import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const LUCID_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const LUCID_MIGRATIONS_ROOT = fileURLToPath(new URL('../drizzle', import.meta.url));

loadDotEnv({ path: join(LUCID_REPO_ROOT, '.env'), quiet: true });

const environmentSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8081),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LUCID_WEB_ORIGIN: z.url().default('http://127.0.0.1:3080'),
  LUCID_STATE_ROOT: z.string().trim().min(1).optional(),
  LUCID_MODEL: z.string().trim().min(1).default('gpt-5.4-mini'),
  LUCID_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(7),
  LUCID_PREFER_API_KEY: z.enum(['true', 'false']).default('false'),
});

const environment = environmentSchema.parse(process.env);

export type LucidConfig = {
  host: string;
  port: number;
  logLevel: string;
  webOrigin: string;
  repoRoot: string;
  stateRoot: string;
  databasePath: string;
  heddleStateRoot: string;
  model: string;
  maxSteps: number;
  preferApiKey: boolean;
};

export function resolveLucidConfig(): LucidConfig {
  const stateRoot = resolve(environment.LUCID_STATE_ROOT ?? join(LUCID_REPO_ROOT, 'local', 'terrarium'));

  return {
    host: environment.HOST,
    port: environment.PORT,
    logLevel: environment.LOG_LEVEL,
    webOrigin: environment.LUCID_WEB_ORIGIN,
    repoRoot: LUCID_REPO_ROOT,
    stateRoot,
    databasePath: join(stateRoot, 'lucid.sqlite'),
    heddleStateRoot: join(stateRoot, 'heddle'),
    model: environment.LUCID_MODEL,
    maxSteps: environment.LUCID_MAX_STEPS,
    preferApiKey: environment.LUCID_PREFER_API_KEY === 'true',
  };
}
