import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino from 'pino';
import { resolveLogFilePath } from './config.js';

const logFilePath = resolveLogFilePath();
mkdirSync(dirname(logFilePath), { recursive: true });

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  pino.multistream([
    { stream: process.stdout },
    {
      stream: pino.destination({
        dest: logFilePath,
        mkdir: true,
        sync: false,
      }),
    },
  ]),
);
