import type { QueryClient } from '@tanstack/react-query';
import { setHostedAccessToken } from '@/lib/trpc';

/**
 * Establishes a hard user-data boundary before replacing an opaque legacy
 * credential. Legacy tokens do not expose a stable subject to the browser, so
 * Lucid must discard every cached query and mutation rather than guess whether
 * the replacement belongs to the same user.
 */
export function replaceLegacyHostedAccessToken(
  queryClient: QueryClient,
  token: string,
): void {
  queryClient.clear();
  setHostedAccessToken(token);
}
