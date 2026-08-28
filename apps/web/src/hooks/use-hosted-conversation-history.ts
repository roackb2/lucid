import { useQuery } from '@tanstack/react-query';
import {
  isAuthenticationRequired,
  lucidClient,
  type HostedConversationTurn,
} from '@/lib/trpc';

const HOSTED_CONVERSATION_HISTORY_KEY = [
  'hosted-conversation',
  'history',
] as const;

const HOSTED_CONVERSATION_STATUS_KEY = [
  'hosted-conversation',
  'status',
] as const;

/** Reads the authenticated server's Chat transport and authorization posture. */
export function useHostedConversationStatus() {
  return useQuery({
    queryKey: HOSTED_CONVERSATION_STATUS_KEY,
    queryFn: () => lucidClient.hostedConversation.status.query(),
    retry: (failureCount, error) => (
      !isAuthenticationRequired(error) && failureCount < 2
    ),
  });
}

/** Owns synchronization for the authenticated user's bounded turn history. */
export function useHostedConversationHistory() {
  return useQuery({
    queryKey: HOSTED_CONVERSATION_HISTORY_KEY,
    queryFn: () => lucidClient.hostedConversation.recent.query(),
    refetchInterval: (query) => (
      hasOpenHostedConversationTurns(query.state.data ?? [])
        ? 2_000
        : false
    ),
    retry: (failureCount, error) => (
      !isAuthenticationRequired(error) && failureCount < 2
    ),
  });
}

export function hasOpenHostedConversationTurns(
  turns: Pick<HostedConversationTurn, 'status'>[],
): boolean {
  return turns.some(({ status }) => (
    status === 'requested' || status === 'running'
  ));
}
