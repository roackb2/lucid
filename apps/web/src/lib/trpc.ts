import {
  createTRPCClient,
  httpBatchLink,
  isTRPCClientError,
} from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import superjson from 'superjson';
import type { AppRouter } from '@lucid/server/router';

const ACCESS_TOKEN_KEY = 'lucid.user-access-token';
const apiUrl = import.meta.env.VITE_LUCID_API_URL ?? '/api/trpc';
let activeAccessToken: string | undefined;
let sessionAccessToken: string | undefined;

export const lucidClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      headers: () => {
        const token = readHostedAccessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
      transformer: superjson,
      url: apiUrl,
    }),
  ],
});

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type DiscoverySnapshot = RouterOutputs['discovery']['snapshot'];
export type FindingView = DiscoverySnapshot['findings'][number];
export type HostedConversationTurn =
  RouterOutputs['hostedConversation']['recent'][number];
export type HostedConversationStatus =
  RouterOutputs['hostedConversation']['status'];

export function isAuthenticationRequired(error: unknown): boolean {
  return isTRPCClientError<AppRouter>(error)
    && error.data?.code === 'UNAUTHORIZED';
}

export function hasHostedAccessToken(): boolean {
  return Boolean(readHostedAccessToken());
}

/** Returns the same tab-scoped user credential used by tRPC. */
export function getHostedAccessToken(): string | undefined {
  return readHostedAccessToken();
}

/** Installs the short-lived identity-provider session used by every API edge. */
export function setSessionAccessToken(token: string | undefined): void {
  sessionAccessToken = token?.trim() || undefined;
}

export function setHostedAccessToken(token: string): void {
  activeAccessToken = token.trim();
  try {
    window.sessionStorage.setItem(ACCESS_TOKEN_KEY, activeAccessToken);
  } catch {
    // Some privacy modes disable storage. The active tab can still proceed.
  }
}

function readHostedAccessToken(): string | undefined {
  if (sessionAccessToken) {
    return sessionAccessToken;
  }
  if (activeAccessToken || typeof window === 'undefined') {
    return activeAccessToken;
  }
  try {
    activeAccessToken = window.sessionStorage
      .getItem(ACCESS_TOKEN_KEY)?.trim() || undefined;
    return activeAccessToken;
  } catch {
    return undefined;
  }
}
