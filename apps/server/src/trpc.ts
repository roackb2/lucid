import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { LucidRequestPrincipal } from './auth/request-principal.js';

export type LucidRequestContext = {
  requestId: string;
  remoteAddress?: string;
  principal?: LucidRequestPrincipal;
};

export const trpc = initTRPC.context<LucidRequestContext>().create({
  transformer: superjson,
});
