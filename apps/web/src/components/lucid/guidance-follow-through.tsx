/**
 * User-facing projection of persisted events after the latest guidance.
 * It shows observable follow-through without interpreting whether the agent
 * learned correctly or assigning a quality score.
 */
import dayjs from 'dayjs';
import {
  CheckCircle2,
  CircleDashed,
  GitCommitHorizontal,
  MessageSquareText,
  NotebookPen,
  Send,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { describeNetworkRequestProgress } from '@/lib/network-request-progress';

type GuidanceFollowThroughProps = {
  activity?: DiscoverySnapshot['guidanceFollowThrough'];
};

export function GuidanceFollowThrough({
  activity,
}: GuidanceFollowThroughProps) {
  if (!activity) {
    return null;
  }
  const requestProgressCopy = activity.requestProgress
    ? describeNetworkRequestProgress(activity.requestProgress)
    : undefined;

  return (
    <section className="guidance-follow-through-card">
      <header className="card-heading">
        <div className="card-heading__icon" aria-hidden="true">
          <GitCommitHorizontal size={18} />
        </div>
        <div>
          <p className="section-label">Since your guidance</p>
          <h2>What changed in the agent’s work</h2>
          <p>
            These are stored events, not an AI claim that it understood you
            correctly. You can compare what you said with what it carried
            forward and actually shared.
          </p>
        </div>
      </header>

      <ol className="follow-through-steps">
        {activity.sourceFinding ? (
          <FollowThroughStep
            icon={<MessageSquareText size={15} />}
            title={`You responded to finding #${activity.sourceFinding.sequence}`}
            timestamp={activity.guidance.createdAt}
          >
            <p className="follow-through-context">
              {activity.sourceFinding.content}
            </p>
            <blockquote>{activity.guidance.content}</blockquote>
          </FollowThroughStep>
        ) : (
          <FollowThroughStep
            icon={<MessageSquareText size={15} />}
            title="You corrected the working direction"
            timestamp={activity.guidance.createdAt}
          >
            {activity.priorWorkingNote ? (
              <p className="follow-through-context">
                Previous note: {activity.priorWorkingNote.content}
              </p>
            ) : null}
            <blockquote>{activity.guidance.content}</blockquote>
          </FollowThroughStep>
        )}

        <FollowThroughStep
          complete={Boolean(activity.workingNote)}
          icon={<NotebookPen size={15} />}
          title={activity.workingNote
            ? 'The private working note changed'
            : 'Waiting for the agent to update its working note'}
          timestamp={activity.workingNote?.createdAt}
        >
          <p>
            {activity.workingNote?.content
              ?? 'Your guidance is durable and remains available to the next agent wake.'}
          </p>
        </FollowThroughStep>

        <FollowThroughStep
          complete={Boolean(activity.request)}
          icon={<Send size={15} />}
          title={activity.request
            ? 'It sent a later request to the network'
            : 'No later network request has used this guidance yet'}
          timestamp={activity.request?.createdAt}
        >
          <p>
            {activity.request?.content
              ?? 'Run a check now when you want the agent to pursue the revised direction immediately.'}
          </p>
        </FollowThroughStep>

        <FollowThroughStep
          complete={Boolean(
            activity.resultingFinding || requestProgressCopy?.complete,
          )}
          icon={<CheckCircle2 size={15} />}
          title={activity.resultingFinding
            ? 'A later finding came back from that request'
            : requestProgressCopy?.title
              ?? (activity.request
                ? 'Waiting for request progress'
                : 'A later result will appear here')}
          timestamp={activity.resultingFinding?.finding.createdAt
            ?? activity.requestProgress?.reviewedAt
            ?? activity.requestProgress?.latestResponseAt}
        >
          <p>
            {activity.resultingFinding?.finding.content
              ?? requestProgressCopy?.description
              ?? (activity.request
                ? 'The request exists, but its delivery state is not available yet.'
                : 'This step stays pending until the agent sends a revised request.')}
          </p>
          {!activity.resultingFinding && requestProgressCopy ? (
            <p className="follow-through-context">
              {requestProgressCopy.detail}
            </p>
          ) : null}
        </FollowThroughStep>
      </ol>
    </section>
  );
}

type FollowThroughStepProps = {
  children: ReactNode;
  complete?: boolean;
  icon: ReactNode;
  timestamp?: string;
  title: string;
};

function FollowThroughStep({
  children,
  complete = true,
  icon,
  timestamp,
  title,
}: FollowThroughStepProps) {
  return (
    <li className={complete ? '' : 'follow-through-step--pending'}>
      <span className="follow-through-step__icon" aria-hidden="true">
        {complete ? icon : <CircleDashed size={15} />}
      </span>
      <div>
        <header>
          <strong>{title}</strong>
          {timestamp ? (
            <time dateTime={timestamp}>
              {dayjs(timestamp).format('MMM D, HH:mm')}
            </time>
          ) : null}
        </header>
        {children}
      </div>
    </li>
  );
}
