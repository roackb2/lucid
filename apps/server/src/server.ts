import { randomUUID } from 'node:crypto';
import heddlePackage from '@roackb2/heddle/package.json' with { type: 'json' };
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { createLucidAuthenticator } from './auth/authenticator.js';
import { resolveLucidConfig } from './config.js';
import { createPostgresPersistence } from './composition/postgres-persistence.js';
import { DiscoveryWorkspaceService } from './lucid/workspace/service.js';
import {
  HeddleRepresentativeAgentRunner,
} from './lucid/representative/heddle-runner.js';
import { ParticipantNetworkService } from './lucid/network/service.js';
import {
  REPRESENTATIVE_AGENT_TASK_ID_PREFIX,
  RepresentativeAgentHeartbeatService,
} from './lucid/representative/heartbeat-service.js';
import { createLucidLogger } from './logger.js';
import { createAppRouter } from './router.js';
import {
  createRepresentativeAgentExecutionHost,
} from './runtime/representative-agent-execution-composition.js';

const config = resolveLucidConfig();
const logger = createLucidLogger(config.logLevel);
const authenticator = createLucidAuthenticator(config.authentication);
const persistence = await createPostgresPersistence(config);
const { repositories, taskAuthority } = persistence;
const agentRunner = new HeddleRepresentativeAgentRunner(
  repositories.communication,
  config,
);
const executionHost = createRepresentativeAgentExecutionHost({
  config,
  repository: repositories.representative,
  taskAuthority,
  taskIdPrefix: REPRESENTATIVE_AGENT_TASK_ID_PREFIX,
  logger,
});
const heartbeats = new RepresentativeAgentHeartbeatService(
  repositories.representative,
  agentRunner,
  config,
  logger,
  taskAuthority,
  executionHost,
);
await heartbeats.initialize();
heartbeats.start();
const discoveryWorkspace = new DiscoveryWorkspaceService(
  repositories.workspace,
  heartbeats,
  {
    model: config.model,
    heddleVersion: heddlePackage.version,
  },
);
const participantNetwork = new ParticipantNetworkService(
  repositories.network,
  heartbeats,
  {
    model: config.model,
    heddleVersion: heddlePackage.version,
  },
);

const server = createHTTPServer({
  router: createAppRouter(discoveryWorkspace, participantNetwork),
  createContext: async ({ req }) => {
    const remoteAddress = req.socket.remoteAddress;
    return {
      requestId: randomUUID(),
      remoteAddress,
      principal: await authenticator.authenticate({
        authorization: req.headers.authorization,
        remoteAddress,
      }),
    };
  },
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
    response.setHeader(
      'Access-Control-Allow-Headers',
      'authorization,content-type',
    );
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
    databaseDriver: 'postgres',
    heartbeatHost: config.heartbeatHost,
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
  await heartbeats.stop();

  const closeError = await serverClosed;
  if (closeError) {
    logger.error({ error: closeError }, 'lucid.server.close_failed');
    process.exitCode = 1;
  }
  await persistence.close();
}
