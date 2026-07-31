import { initTRPC } from '@trpc/server';
import superjson from 'superjson';

export type LucidRequestContext = {
  requestId: string;
};

export const trpc = initTRPC.context<LucidRequestContext>().create({
  transformer: superjson,
});
