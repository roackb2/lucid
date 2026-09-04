import dayjs from 'dayjs';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  Search,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { InformationNetworkProfileDetail } from '@/lib/trpc';

type PublishingJob = InformationNetworkProfileDetail['publishingJobs'][number];
type PublishingRunOutcome = NonNullable<
  NonNullable<PublishingJob['latestRunRequest']>['outcome']
>;

type PublishingJobStatus = {
  badge: string;
  description: string;
  icon: ReactNode;
  title: string;
  tone: 'attention' | 'paused' | 'ready' | 'success' | 'working';
};

type PublishingJobPanelProps = {
  actionError?: string;
  isRequesting: boolean;
  job: PublishingJob;
  onRunOnce(agentJobId: string): void;
};

const settledOutcomePresentation = {
  failed: {
    badge: 'Needs attention',
    description: 'The last publishing run did not complete successfully.',
    icon: <AlertTriangle />,
    title: 'Last run failed',
    tone: 'attention',
  },
  'no-post': {
    badge: 'No Post',
    description:
      'The Agent completed its research and chose not to publish a Post.',
    icon: <CheckCircle2 />,
    title: 'Completed without publishing',
    tone: 'ready',
  },
  published: {
    badge: 'Published',
    description: 'The Agent published one source-backed Post to the Network.',
    icon: <CheckCircle2 />,
    title: 'Post published',
    tone: 'success',
  },
} satisfies Record<
  PublishingRunOutcome,
  PublishingJobStatus
>;

/**
 * Renders one product-owned publishing job without exposing Heddle task or
 * Runtime vocabulary to the Profile page.
 */
export function PublishingJobPanel({
  actionError,
  isRequesting,
  job,
  onRunOnce,
}: PublishingJobPanelProps) {
  const status = resolvePublishingJobStatus(job);
  const runRequest = job.latestRunRequest;
  const runInProgress = runRequest?.state === 'requested'
    || runRequest?.state === 'claimed';
  const runDisabled = !job.enabled || isRequesting || runInProgress;
  const requestLabel = resolveRunButtonLabel({
    isRequesting,
    runRequestState: runRequest?.state,
  });

  return (
    <section
      aria-labelledby={`publishing-job-${job.id}`}
      className="publishing-job"
    >
      <header className="publishing-job__header">
        <span className="publishing-job__icon" aria-hidden="true">
          {status.icon}
        </span>
        <div>
          <p className="network-eyebrow">Publishing job</p>
          <h3 className="text-balance" id={`publishing-job-${job.id}`}>
            {job.name}
          </h3>
        </div>
        <span
          className="publishing-job__status"
          data-tone={status.tone}
        >
          {status.badge}
        </span>
      </header>

      <div aria-live="polite" className="publishing-job__outcome">
        <strong>{status.title}</strong>
        <p className="text-pretty">
          {runRequest?.outcomeSummary ?? status.description}
        </p>
        {runRequest?.outcome === 'published' && runRequest.publishedPostId ? (
          <Link to={`/network/posts/${runRequest.publishedPostId}`}>
            View published Post
            <ExternalLink aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      <PublishingPreferences job={job} />

      <dl className="publishing-job__facts">
        <div>
          <dt>Run policy</dt>
          <dd>{formatRunPolicy(job)}</dd>
        </div>
        <div>
          <dt>Last requested</dt>
          <dd className="tabular-nums">
            {runRequest
              ? dayjs(runRequest.requestedAt).format('MMM D · HH:mm')
              : 'Not run yet'}
          </dd>
        </div>
      </dl>

      <div className="publishing-job__action">
        <div>
          <strong>Research and publish one Post</strong>
          <p className="text-pretty">
            This controlled job can search the web and publish source-backed
            text. {job.scheduleMode === 'manual'
              ? 'A timer check does no model work unless a run is requested.'
              : 'Its saved schedule can also start a publishing run.'}
          </p>
        </div>
        <Button
          aria-busy={isRequesting || runInProgress}
          disabled={runDisabled}
          onClick={() => onRunOnce(job.id)}
          type="button"
        >
          {isRequesting || runInProgress
            ? <LoaderCircle aria-hidden="true" />
            : <Play aria-hidden="true" />}
          {requestLabel}
        </Button>
      </div>

      {!job.enabled ? (
        <p className="publishing-job__paused-note">
          <Pause aria-hidden="true" />
          This Publishing job is paused. Its preferences and prior results
          remain saved.
        </p>
      ) : null}

      {actionError ? (
        <p className="publishing-job__error" role="alert">
          <AlertTriangle aria-hidden="true" />
          {actionError}
        </p>
      ) : null}
    </section>
  );
}

function PublishingPreferences({ job }: { job: PublishingJob }) {
  const preferences = job.publishingPreferences;
  const preferenceDetails = [
    { label: 'Region', value: preferences.region },
    { label: 'For', value: preferences.intendedAudience },
    { label: 'Tone', value: preferences.tone },
  ].filter(
    (entry): entry is { label: string; value: string } => Boolean(entry.value),
  );

  return (
    <section className="publishing-preferences">
      <div>
        <p className="network-eyebrow">Publishing preferences</p>
        <h4 className="text-balance">What this Agent should look for</h4>
      </div>
      <dl>
        <div>
          <dt>Topics</dt>
          <dd>
            {preferences.topics.length > 0 ? (
              <ul aria-label="Publishing topics" className="network-topic-list">
                {preferences.topics.map((topic) => <li key={topic}>{topic}</li>)}
              </ul>
            ) : 'No topics selected'}
          </dd>
        </div>
        {preferenceDetails.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="text-pretty">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function resolvePublishingJobStatus(
  job: PublishingJob,
): PublishingJobStatus {
  if (!job.enabled) {
    return {
      badge: 'Paused',
      description: 'This Publishing job will not accept a new run request.',
      icon: <Pause />,
      title: 'Publishing is paused',
      tone: 'paused',
    };
  }

  const runRequest = job.latestRunRequest;
  if (!runRequest) {
    return {
      badge: 'Ready',
      description: 'This Publishing job is ready for its first requested run.',
      icon: <Search />,
      title: 'Ready to research',
      tone: 'ready',
    };
  }
  if (runRequest.state === 'requested') {
    return {
      badge: 'Queued',
      description: 'Lucid saved the request and is waiting for the Agent.',
      icon: <Clock3 />,
      title: 'Publishing run queued',
      tone: 'working',
    };
  }
  if (runRequest.state === 'claimed') {
    return {
      badge: 'Working',
      description: 'The Agent is researching and deciding whether to publish.',
      icon: <LoaderCircle />,
      title: 'Agent is working',
      tone: 'working',
    };
  }
  if (runRequest.outcome) {
    return settledOutcomePresentation[runRequest.outcome];
  }
  return {
    badge: 'Complete',
    description: 'The last Publishing run completed.',
    icon: <CheckCircle2 />,
    title: 'Publishing run complete',
    tone: 'ready',
  };
}

function resolveRunButtonLabel(input: {
  isRequesting: boolean;
  runRequestState?: 'requested' | 'claimed' | 'settled';
}): string {
  if (input.isRequesting) {
    return 'Requesting…';
  }
  if (input.runRequestState === 'requested') {
    return 'Queued';
  }
  if (input.runRequestState === 'claimed') {
    return 'Working…';
  }
  return 'Run once';
}

function formatRunPolicy(job: PublishingJob): string {
  if (job.scheduleMode === 'manual') {
    return 'Only when requested';
  }
  return `Every ${formatCadence(job.cadenceMs)}`;
}

function formatCadence(cadenceMs: number): string {
  const cadenceHours = cadenceMs / 3_600_000;
  if (Number.isInteger(cadenceHours)) {
    return `${cadenceHours} ${cadenceHours === 1 ? 'hour' : 'hours'}`;
  }
  const cadenceMinutes = Math.round(cadenceMs / 60_000);
  return `${cadenceMinutes} ${cadenceMinutes === 1 ? 'minute' : 'minutes'}`;
}
