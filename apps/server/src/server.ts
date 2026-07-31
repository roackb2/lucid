import { randomUUID } from 'node:crypto';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { LUCID_MIGRATIONS_ROOT, resolveLucidConfig } from './config.js';
import { LucidSqliteDatabase } from './database/sqlite-database.js';
import { SqliteDiscoveryRepository } from './database/sqlite-discovery-repository.js';
import { DiscoveryRunService } from './lucid/discovery-run-service.js';
import { HeddleAgentRunner } from './lucid/heddle-agent-runner.js';
import { createLucidLogger } from './logger.js';
import { createAppRouter } from './router.js';

const HEDDLE_VERSION = '5.6.1';
const config = resolveLucidConfig();
const logger = createLucidLogger(config.logLevel);
const database = new LucidSqliteDatabase(config.databasePath);

database.migrate(LUCID_MIGRATIONS_ROOT);

const repository = new SqliteDiscoveryRepository(database);
await repository.initialize();
const agentRunner = new HeddleAgentRunner(repository, config);
const discoveryRuns = new DiscoveryRunService(
  repository,
  agentRunner,
  {
    model: config.model,
    heddleVersion: HEDDLE_VERSION,
  },
  logger,
);

const server = createHTTPServer({
  router: createAppRouter(discoveryRuns),
  createContext: () => ({
    requestId: randomUUID(),
  }),
  onError: ({ ctx, error, path }) => {
    logger.error({
      error,
      path,
      requestId: ctx?.requestId,
    }, 'lucid.request.failed');
  },
  middleware: (request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', config.webOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  },
});

let shuttingDown = false;

server.listen(config.port, config.host, () => {
  logger.info({
    address: `http://${config.host}:${config.port}`,
    databasePath: config.databasePath,
    model: config.model,
  }, 'lucid.server.ready');
});

server.on('error', (error) => {
  logger.fatal({ error }, 'lucid.server.error');
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'lucid.server.stopping');

  const serverClosed = new Promise<Error | undefined>((resolve) => {
    server.close((error) => resolve(error));
  });
  await discoveryRuns.stop();

  const closeError = await serverClosed;
  if (closeError) {
    logger.error({ error: closeError }, 'lucid.server.close_failed');
    process.exitCode = 1;
  }
  database.close();
}
