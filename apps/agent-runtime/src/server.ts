import { mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import pino from 'pino';
import { loadRuntimeConfig } from './config.js';
import { HeddleTurnExecutor } from './heddle-turn-executor.js';
import { createRuntimeHttpApp } from './http-server.js';
import { AgentRuntimeService } from './runtime-service.js';

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const logger = pino({
    level: config.logLevel,
    base: { service: 'lucid-agent-runtime' },
  });
  await Promise.all([
    mkdir(config.workspaceRoot, { recursive: true }),
    mkdir(config.stateRoot, { recursive: true }),
  ]);

  const runtime = new AgentRuntimeService({
    config,
    executor: new HeddleTurnExecutor(config),
  });
  const app = createRuntimeHttpApp({ config, runtime, logger });
  const server = createServer(app);
  server.requestTimeout = 0;

  await listen(server, config.port, config.host);
  logger.info({ host: config.host, port: config.port, mode: config.mode }, 'Agent runtime listening');

  let shutdownStarted = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    logger.info({ signal }, 'Agent runtime shutting down');
    server.close();
    await runtime.shutdown();
    server.closeAllConnections();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup failure';
  process.stderr.write(`Agent runtime failed to start: ${message}\n`);
  process.exitCode = 1;
});
