/**
 * Participant-facing projection of persisted events after the latest feedback.
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

type FeedbackFollowThroughProps = {
  activity?: DiscoverySnapshot['feedbackFollowThrough'];
};

export function FeedbackFollowThrough({
  activity,
}: FeedbackFollowThroughProps) {
  if (!activity) {
    return null;
  }

  return (
    <section className="feedback-follow-through-card">
      <header className="card-heading">
        <div className="card-heading__icon" aria-hidden="true">
          <GitCommitHorizontal size={18} />
        </div>
        <div>
          <p className="section-label">Since your feedback</p>
          <h2>What changed in the representative’s work</h2>
          <p>
            These are stored events, not an AI claim that it understood you
            correctly. You can compare what you said with what it carried
            forward and actually shared.
          </p>
        </div>
      </header>

      <ol className="follow-through-steps">
        <FollowThroughStep
          icon={<MessageSquareText size={15} />}
          title={`You responded to finding #${activity.sourceFinding.sequence}`}
          timestamp={activity.feedback.createdAt}
        >
          <p className="follow-through-context">
            {activity.sourceFinding.content}
          </p>
          <blockquote>{activity.feedback.content}</blockquote>
        </FollowThroughStep>

        <FollowThroughStep
          complete={Boolean(activity.workingNote)}
          icon={<NotebookPen size={15} />}
          title={activity.workingNote
            ? 'The private working note changed'
            : 'Waiting for the representative to update its working note'}
          timestamp={activity.workingNote?.createdAt}
        >
          <p>
            {activity.workingNote?.content
              ?? 'Your feedback is durable and remains available to the next agent wake.'}
          </p>
        </FollowThroughStep>

        <FollowThroughStep
          complete={Boolean(activity.request)}
          icon={<Send size={15} />}
          title={activity.request
            ? 'It sent a later request to the network'
            : 'No later network request has used this feedback yet'}
          timestamp={activity.request?.createdAt}
        >
          <p>
            {activity.request?.content
              ?? 'Run a check now when you want the representative to pursue the revised direction immediately.'}
          </p>
        </FollowThroughStep>

        <FollowThroughStep
          complete={Boolean(activity.resultingFinding)}
          icon={<CheckCircle2 size={15} />}
          title={activity.resultingFinding
            ? 'A later finding came back from that request'
            : activity.request
              ? 'No new finding from that request so far'
              : 'A later result will appear here'}
          timestamp={activity.resultingFinding?.finding.createdAt}
        >
          <p>
            {activity.resultingFinding?.finding.content
              ?? (activity.request
                ? 'Lucid remains quiet until the representative reports a concrete increment.'
                : 'This step stays pending until a revised request produces a reportable increment.')}
          </p>
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
