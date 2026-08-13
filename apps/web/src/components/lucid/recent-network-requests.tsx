/**
 * User-facing history of earlier disclosed network requests.
 *
 * This component deliberately renders the bounded projection supplied by the
 * server. It must not reconstruct a global event log or present empty
 * heartbeat wakes as meaningful work performed for the user.
 */
import dayjs from 'dayjs';
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  MessageSquareText,
} from 'lucide-react';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { describeNetworkRequestProgress } from '@/lib/network-request-progress';

type NetworkRequestHistory = NonNullable<
  DiscoverySnapshot['networkActivity']
>['previousRequests'];

type RecentNetworkRequestsProps = {
  requests: NetworkRequestHistory;
};

export function RecentNetworkRequests({
  requests,
}: RecentNetworkRequestsProps) {
  if (!requests.length) {
    return null;
  }

  return (
    <section
      aria-labelledby="recent-network-requests-title"
      className="recent-network-requests"
    >
      <header className="card-heading">
        <div className="card-heading__icon" aria-hidden="true">
          <History size={18} />
        </div>
        <div>
          <p className="section-label">Recent checks</p>
          <h2 id="recent-network-requests-title">
            What your agent tried before this
          </h2>
          <p>
            Earlier requests stay visible so a new check does not erase what
            was already tried, learned, or closed without a finding.
          </p>
        </div>
      </header>

      <ol className="recent-network-requests__list">
        {requests.map((item) => {
          const progressCopy = describeNetworkRequestProgress(item.progress);
          const activityAt = item.progress.reviewedAt
            ?? item.progress.latestResponseAt
            ?? item.request.createdAt;

          return (
            <li key={item.request.sequence}>
              <details className="recent-network-request">
                <summary>
                  <span
                    className={`recent-network-request__status ${
                      progressCopy.complete
                        ? 'recent-network-request__status--complete'
                        : ''
                    }`}
                    aria-hidden="true"
                  >
                    {progressCopy.complete
                      ? <CheckCircle2 size={15} />
                      : item.progress.phase === 'messages-pending-review'
                        ? <MessageSquareText size={15} />
                        : <Clock3 size={15} />}
                  </span>
                  <span className="recent-network-request__summary">
                    <span>
                      <strong>{progressCopy.title}</strong>
                      <time dateTime={activityAt}>
                        {dayjs(activityAt).format('MMM D, HH:mm')}
                      </time>
                    </span>
                    <span className="recent-network-request__request">
                      {item.request.content}
                    </span>
                    <small>{progressCopy.detail}</small>
                  </span>
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>

                <div className="recent-network-request__details">
                  <p>{progressCopy.description}</p>

                  {item.guidance ? (
                    <blockquote>
                      <strong>
                        {item.guidance.kind === 'feedback_saved'
                          ? 'Following your feedback'
                          : 'Following your guidance'}
                      </strong>
                      <p>{item.guidance.content}</p>
                    </blockquote>
                  ) : null}

                  {item.linkedFindings.length ? (
                    <div className="recent-network-request__findings">
                      <strong>
                        {item.linkedFindings.length === 1
                          ? 'Finding reported from this request'
                          : `${item.linkedFindings.length} findings reported from this request`}
                      </strong>
                      <ul>
                        {item.linkedFindings.map((finding) => (
                          <li key={finding.sequence}>{finding.content}</li>
                        ))}
                      </ul>
                    </div>
                  ) : progressCopy.complete ? (
                    <p className="recent-network-request__no-finding">
                      No finding was reported from this request.
                    </p>
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ol>

      <footer>
        Up to five earlier disclosed requests for this saved interest are
        shown. Routine wakes that shared nothing are not included.
      </footer>
    </section>
  );
}
