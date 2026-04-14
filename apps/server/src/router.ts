import { createHTTPServer } from '@trpc/server/adapters/standalone';
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
      return store.createAgent(input);
    }),

    list: procedure.query(async () => {
      return store.listAgents();
    }),

    get: procedure.input(agentIdInputSchema).query(async ({ input }) => {
      return store.getAgent(input.agentId);
    }),

    messages: procedure.input(agentIdInputSchema).query(async ({ input }) => {
      return store.getAgentMessages(input.agentId);
    }),
  }),
});

export type AppRouter = typeof appRouter;

export function createLucidHttpServer(port: number) {
  return createHTTPServer({
    router: appRouter,
    createContext() {
      return {};
    },
  }).listen(port);
}
