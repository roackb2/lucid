import { ChevronDown, Inbox } from 'lucide-react';
import type { FindingView } from '@/lib/trpc';
import {
  describeNetworkRequestProgress,
  type NetworkRequestProgress,
} from '@/lib/network-request-progress';
import { FindingCard } from './finding-card';

type FindingsFeedProps = {
  currentFindings: FindingView[];
  earlierFindings: FindingView[];
  backgroundChecksEnabled: boolean;
  isChecking: boolean;
  isSubmittingFeedback: boolean;
  requestProgress?: NetworkRequestProgress;
  onFeedback(findingSequence: number, content: string): Promise<unknown>;
};

export function FindingsFeed({
  currentFindings,
  earlierFindings,
  backgroundChecksEnabled,
  isChecking,
  isSubmittingFeedback,
  requestProgress,
  onFeedback,
}: FindingsFeedProps) {
  const emptyState = describeEmptyInbox({
    backgroundChecksEnabled,
    isChecking,
    requestProgress,
  });

  return (
    <section className="findings-section" id="findings">
      <header className="findings-heading">
        <div>
          <p className="section-label">Discovery inbox</p>
          <h2>Current assignment</h2>
        </div>
        <span>{currentFindings.length}</span>
      </header>

      {currentFindings.length ? (
        <div className="findings-list">
          {currentFindings.map((finding, index) => (
            <FindingCard
              finding={finding}
              isLatest={index === 0}
              isSubmitting={isSubmittingFeedback}
              key={finding.finding.id}
              onFeedback={onFeedback}
            />
          ))}
        </div>
      ) : (
        <div className="findings-empty">
          <span aria-hidden="true"><Inbox size={22} /></span>
          <div>
            <h3>{emptyState.title}</h3>
            <p>{emptyState.description}</p>
          </div>
        </div>
      )}

      {earlierFindings.length ? (
        <details className="finding-history">
          <summary>
            <span>Earlier assignments</span>
            <span>{earlierFindings.length}</span>
            <ChevronDown size={15} />
          </summary>
          <div className="findings-list">
            {earlierFindings.map((finding) => (
              <FindingCard
                finding={finding}
                isLatest={false}
                isSubmitting={isSubmittingFeedback}
                key={finding.finding.id}
                onFeedback={onFeedback}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function describeEmptyInbox(input: {
  backgroundChecksEnabled: boolean;
  isChecking: boolean;
  requestProgress?: NetworkRequestProgress;
}): { title: string; description: string } {
  if (input.requestProgress) {
    return describeNetworkRequestProgress(input.requestProgress);
  }
  if (input.isChecking) {
    return {
      title: 'Checking available messages…',
      description:
        'A finding will appear only if participant agents return a specific connection. You decide whether it is useful.',
    };
  }
  if (!input.backgroundChecksEnabled) {
    return {
      title: 'Background checks are paused',
      description:
        'Resume background checks when you want your representative to process new messages.',
    };
  }
  return {
    title: 'Waiting for something relevant',
    description:
      'You can leave this workspace. Lucid will keep the interest and show what another representative brings back without deciding its value for you.',
  };
}
