import {
  isAuthenticationRequired,
  type HostedConversationStatus,
} from '@/lib/trpc';

const DEVELOPMENT_LOOPBACK_ACCESS_TOKEN = 'lucid-development-loopback';

export type HostedConversationAvailability = {
  canStartTurn: boolean;
  message?: string;
  runtimeLabel: string;
  state: 'checking' | 'ready' | 'unavailable' | 'sign-in-required' | 'error';
};

/** Presents the server-owned Chat transport and authentication contract. */
export function presentHostedConversationAvailability(input: {
  error?: unknown;
  hasBearerAccessToken: boolean;
  isPending: boolean;
  status?: HostedConversationStatus;
}): HostedConversationAvailability {
  if (input.isPending) {
    return {
      canStartTurn: false,
      message: 'Checking the Agent Runtime connection…',
      runtimeLabel: 'Checking',
      state: 'checking',
    };
  }
  if (input.error) {
    return isAuthenticationRequired(input.error)
      ? {
          canStartTurn: false,
          message: 'Your session expired. Sign in again before starting a Chat turn.',
          runtimeLabel: 'Sign in required',
          state: 'sign-in-required',
        }
      : {
          canStartTurn: false,
          message: 'Lucid could not verify the Agent Runtime connection.',
          runtimeLabel: 'Unavailable',
          state: 'error',
        };
  }
  if (!input.status?.enabled) {
    return {
      canStartTurn: false,
      message: 'Chat is not connected to an Agent Runtime in this environment.',
      runtimeLabel: 'Not connected',
      state: 'unavailable',
    };
  }
  if (
    input.status.authorization === 'bearer'
    && !input.hasBearerAccessToken
  ) {
    return {
      canStartTurn: false,
      message: 'Your session expired. Sign in again before starting a Chat turn.',
      runtimeLabel: 'Sign in required',
      state: 'sign-in-required',
    };
  }
  return {
    canStartTurn: true,
    runtimeLabel: input.status.transport === 'agentcore'
      ? 'AgentCore'
      : 'Execution Host',
    state: 'ready',
  };
}

/**
 * Supplies the adopter client with a non-secret marker in loopback development.
 * The server still authenticates the socket address and derives the local user.
 */
export function resolveHostedConversationAccessToken(
  status: HostedConversationStatus | undefined,
  bearerAccessToken: string | undefined,
): string | undefined {
  if (bearerAccessToken) {
    return bearerAccessToken;
  }
  return status?.enabled
    && status.authorization === 'development-loopback'
    ? DEVELOPMENT_LOOPBACK_ACCESS_TOKEN
    : undefined;
}
