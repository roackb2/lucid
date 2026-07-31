import { Inbox } from 'lucide-react';
import type {
  AgentView,
  FindingView,
} from '@/lib/trpc';
import { FindingCard } from './finding-card';

type FindingsFeedProps = {
  agents: AgentView[];
  findings: FindingView[];
  isRunActive: boolean;
  isSubmittingFeedback: boolean;
  onFeedback(findingSequence: number, content: string): Promise<unknown>;
};

export function FindingsFeed({
  agents,
  findings,
  isRunActive,
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
            <h3>{isRunActive ? 'Checking available sources…' : 'No findings yet'}</h3>
            <p>
              {isRunActive
                ? 'The first result will appear here when the current check finishes.'
                : 'Save an interest and run a discovery check. Lucid will report a possible match or an explicit no-match result.'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
