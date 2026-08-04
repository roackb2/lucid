import { Inbox } from 'lucide-react';
import type {
  AgentView,
  FindingView,
} from '@/lib/trpc';
import { FindingCard } from './finding-card';

type FindingsFeedProps = {
  agents: AgentView[];
  findings: FindingView[];
  backgroundChecksEnabled: boolean;
  isChecking: boolean;
  isSubmittingFeedback: boolean;
  onFeedback(findingSequence: number, content: string): Promise<unknown>;
};

export function FindingsFeed({
  agents,
  findings,
  backgroundChecksEnabled,
  isChecking,
  isSubmittingFeedback,
  onFeedback,
}: FindingsFeedProps) {
  return (
    <section className="findings-section" id="findings">
      <header className="findings-heading">
        <div>
          <p className="section-label">Discovery inbox</p>
          <h2>Findings</h2>
        </div>
        <span>{findings.length}</span>
      </header>

      {findings.length ? (
        <div className="findings-list">
          {findings.map((finding, index) => (
            <FindingCard
              agents={agents}
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
            <h3>
              {isChecking
                ? 'Checking available messages…'
                : backgroundChecksEnabled
                  ? 'Waiting for something relevant'
                  : 'Background checks are paused'}
            </h3>
            <p>
              {isChecking
                ? 'A finding will appear only if participant agents return a specific connection. You decide whether it is useful.'
                : backgroundChecksEnabled
                  ? 'You can leave this workspace. Lucid will keep the interest and show what another representative brings back without deciding its value for you.'
                  : 'Resume background checks when you want representative agents to process new messages.'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
