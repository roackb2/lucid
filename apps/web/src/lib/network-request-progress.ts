/**
 * Shared user-facing language for one persisted network request.
 * Components may choose different layouts, but they should not reinterpret
 * the durable request phase or make completed silence look like pending work.
 */
import type { DiscoverySnapshot } from '@/lib/trpc';

export type NetworkRequestProgress = NonNullable<
  NonNullable<DiscoverySnapshot['networkActivity']>['requestProgress']
>;

export type NetworkRequestProgressCopy = {
  title: string;
  description: string;
  detail: string;
  complete: boolean;
};

const COPY_BY_PHASE: Record<
  NetworkRequestProgress['phase'],
  (progress: NetworkRequestProgress) => NetworkRequestProgressCopy
> = {
  'waiting-for-network': () => ({
    title: 'Waiting for a concrete network contribution',
    description:
      'The request is out, but no user message has reached your agent yet.',
    detail: 'No delivered messages yet',
    complete: false,
  }),
  'messages-pending-review': (progress) => ({
    title: `${formatCount(
      progress.pendingReviewCount,
      'delivered message',
    )} pending review`,
    description:
      'The messages are durably in your agent’s mailbox. A completed review will either produce a finding or close this request quietly.',
    detail: describeDeliveredMessages(progress),
    complete: false,
  }),
  'finding-reported': (progress) => ({
    title: 'Review complete — a finding was reported',
    description:
      'Your agent reviewed every delivered message from this request and added a concrete increment to the discovery inbox.',
    detail: describeDeliveredMessages(progress),
    complete: true,
  }),
  'reviewed-without-finding': (progress) => ({
    title: 'Review complete — nothing new to report',
    description:
      'Your agent reviewed every delivered message from this request and did not add a finding. This check is complete, not still waiting.',
    detail: describeDeliveredMessages(progress),
    complete: true,
  }),
};

export function describeNetworkRequestProgress(
  progress: NetworkRequestProgress,
): NetworkRequestProgressCopy {
  return COPY_BY_PHASE[progress.phase](progress);
}

function describeDeliveredMessages(progress: NetworkRequestProgress): string {
  const delivery = formatCount(
    progress.responseCount,
    'message delivered',
    'messages delivered',
  );
  if (!progress.originatingUserCount) {
    return delivery;
  }

  return `${formatCount(
    progress.originatingUserCount,
    'originating user',
  )} · ${formatCount(
    progress.originatingResponseCount,
    'originating contribution',
  )} · ${delivery}`;
}

function formatCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
