import pino from 'pino';

export function createLucidLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: ['apiKey', '*.apiKey', 'credential', '*.credential'],
      censor: '[redacted]',
    },
  });
}

export type LucidLogger = ReturnType<typeof createLucidLogger>;
