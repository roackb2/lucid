import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LUCID_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const DEFAULT_DATABASE_URL = 'postgres://lucid:12345678@localhost:5432/lucid?sslmode=disable';

loadDotEnv();

export function resolveDatabaseUrl() {
  return process.env.LUCID_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function resolvePort() {
  return Number.parseInt(process.env.PORT ?? '8081', 10);
}

export function resolveLogFilePath() {
  return resolve(LUCID_REPO_ROOT, process.env.LUCID_LOG_FILE ?? 'local/logs/server.log');
}

function loadDotEnv() {
  const path = resolve(LUCID_REPO_ROOT, '.env');
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
