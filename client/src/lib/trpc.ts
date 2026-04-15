import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import type { AppRouter } from '../../../apps/server/src/router'

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: import.meta.env.VITE_LUCID_TRPC_URL ?? 'http://localhost:8081',
      transformer: superjson,
    }),
  ],
})
