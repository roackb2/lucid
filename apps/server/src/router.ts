import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { logger } from './logger.js';
import { createLucidStore } from './store.js';
import { agentIdInputSchema, createAgentInputSchema } from './types.js';
import { procedure, router } from './trpc.js';

const store = createLucidStore();

export const appRouter = router({
  healthz: procedure.query(() => ({
    ok: true,
    service: 'lucid-server',
    mode: 'ts-rewrite',
    heartbeatRoot: store.rootDir,
  })),

  agents: router({
    create: procedure.input(createAgentInputSchema).mutation(async ({ input }) => {
      return logProcedure('agents.create', () => store.createAgent(input), { input });
    }),

    list: procedure.query(async () => {
      return logProcedure('agents.list', () => store.listAgents());
    }),

    get: procedure.input(agentIdInputSchema).query(async ({ input }) => {
      return logProcedure('agents.get', () => store.getAgent(input.agentId), { input });
    }),

    messages: procedure.input(agentIdInputSchema).query(async ({ input }) => {
      return logProcedure('agents.messages', () => store.getAgentMessages(input.agentId), { input });
    }),

    runOnce: procedure.input(agentIdInputSchema).mutation(async ({ input }) => {
      return logProcedure('agents.runOnce', () => store.runAgentOnce(input.agentId), { input });
    }),
  }),
});

export type AppRouter = typeof appRouter;

export function createLucidHttpServer(port: number) {
  return createHTTPServer({
    middleware(request, response, next) {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'content-type');

      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }

      next();
    },
    router: appRouter,
    createContext() {
      return {};
    },
  }).listen(port);
}

async function logProcedure<T>(
  name: string,
  run: () => Promise<T>,
  meta: Record<string, unknown> = {},
): Promise<T> {
  logger.info(meta, `${name}.started`);
  try {
    const result = await run();
    logger.info({
      ...meta,
      result: summarizeResult(result),
    }, `${name}.finished`);
    return result;
  } catch (error) {
    logger.error({
      ...meta,
      error,
    }, `${name}.failed`);
    throw error;
  }
}

function summarizeResult(result: unknown) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  if ('agent_id' in result) {
    return { agent_id: result.agent_id };
  }

  if ('agents' in result && Array.isArray(result.agents)) {
    return { agents: result.agents.length };
  }

  return result;
}
