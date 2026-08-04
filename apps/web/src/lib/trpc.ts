import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import superjson from 'superjson';
import type { AppRouter } from '@lucid/server/router';

const apiUrl = import.meta.env.VITE_LUCID_API_URL ?? 'http://127.0.0.1:8081';

export const lucidClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      transformer: superjson,
      url: apiUrl,
    }),
  ],
});

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type DiscoverySnapshot = RouterOutputs['discovery']['snapshot'];
export type FindingView = DiscoverySnapshot['findings'][number];
