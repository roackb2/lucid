import { randomUUID } from 'node:crypto';
import heddlePackage from '@heddleagent/runtime/package.json' with { type: 'json' };
import {
  HostedHeartbeatCoordinatorClient,
} from '@heddleagent/execution-host-client/coordinator';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { createLucidAuthenticator } from './auth/authenticator.js';
import { resolveLucidConfig } from './config.js';
import {
  createHostedExecutionComposition,
} from './composition/hosted-execution.js';
import { createPostgresPersistence } from './composition/postgres-persistence.js';
import {
  resolveHostedExecutionConfig,
} from './hosted-execution/config.js';
import { handleHealthRequest } from './health.js';
import { DiscoveryWorkspaceService } from './lucid/workspace/service.js';
import { UserNetworkService } from './lucid/network/service.js';
import {
  CoordinatorAgentHeartbeatService,
} from './hosted-execution/heartbeat/agent-heartbeat-service.js';
import { createLucidLogger } from './logger.js';
import { createAppRouter } from './router.js';
import {
  createStaticSpaRequestHandler,
} from './static-spa/static-spa-request-handler.js';
import {
  HostedConversationHistoryService,
} from './hosted-execution/conversation/history-service.js';

const TRPC_BASE_PATH = '/api/trpc/';

const config = resolveLucidConfig();
const hostedExecutionConfig = resolveHostedExecutionConfig(
  process.env,
  config.repoRoot,
);
if (!hostedExecutionConfig?.heartbeatCoordinator) {
  throw new Error(
    'Lucid requires the hosted Execution Host and heartbeat coordinator profile; embedded heartbeat scheduling has been removed.',
  );
}
const logger = createLucidLogger(config.logLevel);
const persistence = await createPostgresPersistence(config);
const { stores } = persistence;
const authenticator = createLucidAuthenticator(
  config.authentication,
  stores.network,
);
const coordinator = new HostedHeartbeatCoordinatorClient({
  baseUrl: hostedExecutionConfig.heartbeatCoordinator.baseUrl,
  apiToken: hostedExecutionConfig.heartbeatCoordinator.apiToken,
});
const heartbeats = new CoordinatorAgentHeartbeatService(
  stores.agent,
  coordinator,
  {
    intervalMs: config.heartbeatIntervalMs,
    model: config.model,
    maxSteps: config.maxSteps,
  },
  logger,
);
const discoveryWorkspace = new DiscoveryWorkspaceService(
  stores.workspace,
  heartbeats,
  {
    model: config.model,
    heddleVersion: heddlePackage.version,
  },
);
const userNetwork = new UserNetworkService(
  stores.network,
  heartbeats,
  {
    model: config.model,
    heddleVersion: heddlePackage.version,
  },
);
const conversationHistory = new HostedConversationHistoryService(
  stores.conversationHistory,
  stores.conversationLifecycle,
  {
    tenantId: hostedExecutionConfig.tenantId,
    productSessionId: hostedExecutionConfig.productSessionId,
  },
);
const hostedExecution = await createHostedExecutionComposition({
  config: hostedExecutionConfig,
  authenticator,
  discoveryWorkspace,
  logger,
  conversationLifecycle: stores.conversationLifecycle,
  heartbeatStore: stores.agent,
});
const staticSpaRequestHandler = config.webRoot
  ? await createStaticSpaRequestHandler(config.webRoot)
  : undefined;
const server = createHTTPServer({
  basePath: TRPC_BASE_PATH,
  router: createAppRouter(
    discoveryWorkspace,
    userNetwork,
    conversationHistory,
    {
      allowSelfEnrollment: config.authentication.mode === 'supabase'
        && config.authentication.allowSelfEnrollment,
      hostedConversation: {
        enabled: Boolean(hostedExecution),
        transport: hostedExecutionConfig?.transport.mode ?? null,
        authorization: config.authentication.mode === 'development'
          ? 'development-loopback'
          : 'bearer',
      },
    },
  ),
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
    if (handleHealthRequest(request, response)) {
      return;
    }

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

    if (hostedExecution.http.handle(request, response)) {
      return;
    }

    if (isTrpcRequest(request.url)) {
      next();
      return;
    }

    if (staticSpaRequestHandler?.tryServe(request, response)) {
      return;
    }

    response.writeHead(404, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify({ error: 'Not found.' }));
  },
});

let shuttingDown = false;

try {
  await listen(server, config.port, config.host);
  await heartbeats.initialize();
} catch (error) {
  logger.fatal({ error }, 'lucid.server.start_failed');
  if (server.listening) {
    await closeServer(server);
  }
  await hostedExecution.close();
  await persistence.close();
  throw error;
}
logger.info({
  address: `http://${config.host}:${config.port}`,
  databaseDriver: 'postgres',
  heartbeatHost: 'coordinator',
  hostedExecutionEnabled: true,
  model: config.model,
  webEnabled: Boolean(staticSpaRequestHandler),
}, 'lucid.server.ready');

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
  await hostedExecution.close();

  const closeError = await serverClosed;
  if (closeError) {
    logger.error({ error: closeError }, 'lucid.server.close_failed');
    process.exitCode = 1;
  }
  await persistence.close();
}

function isTrpcRequest(requestUrl: string | undefined): boolean {
  const pathname = new URL(requestUrl ?? '/', 'http://localhost').pathname;
  return pathname === TRPC_BASE_PATH.slice(0, -1)
    || pathname.startsWith(TRPC_BASE_PATH);
}

async function listen(
  server: ReturnType<typeof createHTTPServer>,
  port: number,
  host: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

async function closeServer(
  server: ReturnType<typeof createHTTPServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
