import dayjs from 'dayjs';
import {
  CheckCircle2,
  ChevronDown,
  CircleSlash2,
  MessageSquareText,
  Route,
  Send,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { AgentView, FindingView } from '@/lib/trpc';

type FindingCardProps = {
  agents: AgentView[];
  finding: FindingView;
  isLatest: boolean;
  isSubmitting: boolean;
  onFeedback(findingSequence: number, content: string): Promise<unknown>;
};

export function FindingCard({
  agents,
  finding,
  isLatest,
  isSubmitting,
  onFeedback,
}: FindingCardProps) {
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [explanationOpen, setExplanationOpen] = useState(isLatest);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const sourceAgents = finding.sources.flatMap((source) => {
    const sourceAgent = source.actorAgentId
      ? agentById.get(source.actorAgentId)
      : undefined;
    return sourceAgent ? [sourceAgent] : [];
  });
  const sourceDescription = describeSourceMix(sourceAgents);

  const submitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = feedbackDraft.trim();
    if (!content) {
      return;
    }
    try {
      await onFeedback(finding.finding.sequence, content);
    } catch {
      return;
    }
    setFeedbackDraft('');
  };

  return (
    <article className={`finding-card ${finding.noMatch ? 'finding-card--empty' : ''}`}>
      <header className="finding-card__header">
        <div className="finding-card__status" aria-hidden="true">
          {finding.noMatch
            ? <CircleSlash2 size={18} />
            : <CheckCircle2 size={18} />}
        </div>
        <div>
          <div className="finding-card__meta">
            <span>{finding.noMatch ? 'Completed check' : 'New finding'}</span>
            {isLatest ? <span className="new-badge">Latest</span> : null}
            <time dateTime={finding.finding.createdAt}>
              {dayjs(finding.finding.createdAt).format('MMM D, HH:mm')}
            </time>
          </div>
          <h3>
            {finding.noMatch
              ? 'Earlier completed check'
              : 'Something from your network may be relevant'}
          </h3>
        </div>
      </header>

      <p className="finding-card__content">{finding.finding.content}</p>

      <div className="finding-card__chips">
        <span>
          <Route size={13} />
          {finding.sources.length} source {finding.sources.length === 1 ? 'message' : 'messages'}
        </span>
        <span>{sourceDescription}</span>
      </div>

      {finding.sources.length || finding.outboundMessages.length ? (
        <details
          className="finding-explanation"
          onToggle={(event) => {
            setExplanationOpen(event.currentTarget.open);
          }}
          open={explanationOpen}
        >
          <summary>
            <span>See source messages and what Lucid shared</span>
            <ChevronDown size={15} />
          </summary>
          <div className="finding-explanation__content">
            {finding.sources.length ? (
              <section>
                <h4>Messages that caused this finding</h4>
                <ol>
                  {finding.sources.map((source) => (
                    <li key={source.id}>
                      <span>#{source.sequence}</span>
                      <div>
                        <div className="source-message__identity">
                          <strong>
                            {source.actorAgentId
                              ? agentById.get(source.actorAgentId)?.name
                                ?? 'Unknown agent'
                              : 'System'}
                          </strong>
                          {source.actorAgentId
                            ? <SourceKindBadge agent={agentById.get(source.actorAgentId)} />
                            : null}
                        </div>
                        <p>{source.content}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {finding.outboundMessages.length ? (
              <section>
                <h4>What Lucid shared while looking</h4>
                <ul>
                  {finding.outboundMessages.map((message) => (
                    <li key={message.id}>
                      <span>#{message.sequence}</span>
                      <p>{message.content}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <p className="source-caveat">
              These event references establish the delivery path. They do not
              verify that the message is true or useful.
            </p>
          </div>
        </details>
      ) : null}

      {finding.feedback ? (
        <section className="saved-feedback">
          <div>
            <MessageSquareText size={14} />
            <strong>Your feedback</strong>
          </div>
          <p>{finding.feedback.content}</p>
          <small>Lucid will receive this during its next wake.</small>
        </section>
      ) : (
        <form className="finding-feedback" onSubmit={submitFeedback}>
          <label htmlFor={`finding-feedback-${finding.finding.sequence}`}>
            {finding.noMatch
              ? 'Was reporting no match the right choice?'
              : 'Was this useful? Tell Lucid what it understood or missed.'}
          </label>
          <div>
            <textarea
              id={`finding-feedback-${finding.finding.sequence}`}
              maxLength={1_600}
              onChange={(event) => setFeedbackDraft(event.target.value)}
              placeholder="Feedback remains private to your agent..."
              rows={3}
              value={feedbackDraft}
            />
            <Button
              aria-label="Save feedback for this finding"
              disabled={!feedbackDraft.trim() || isSubmitting}
              size="icon"
              type="submit"
            >
              <Send size={15} />
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}

function describeSourceMix(agents: AgentView[]): string {
  const uniqueAgents = new Map(agents.map((agent) => [agent.id, agent]));
  const sourceKinds = new Set(
    [...uniqueAgents.values()].map((agent) => agent.participant.kind),
  );
  if (sourceKinds.has('human') && sourceKinds.has('synthetic')) {
    return 'Mixed real and simulated sources';
  }
  if (sourceKinds.has('human')) {
    return uniqueAgents.size === 1
      ? '1 assisted real source'
      : `${uniqueAgents.size} assisted real sources`;
  }
  if (sourceKinds.has('synthetic')) {
    return uniqueAgents.size === 1
      ? '1 simulated source'
      : `${uniqueAgents.size} simulated sources`;
  }
  return 'Source type unavailable';
}

function SourceKindBadge({ agent }: { agent?: AgentView }) {
  if (!agent) {
    return null;
  }
  return (
    <span className={
      agent.participant.kind === 'human'
        ? 'source-badge source-badge--real'
        : 'source-badge'
    }>
      {agent.participant.kind === 'human'
        ? 'Real · assisted'
        : 'Simulated fixture'}
    </span>
  );
}
