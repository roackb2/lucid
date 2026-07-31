import dayjs from 'dayjs';
import {
  CheckCircle2,
  ChevronDown,
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
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

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
    <article className="finding-card">
      <header className="finding-card__header">
        <div className="finding-card__status" aria-hidden="true">
          <CheckCircle2 size={18} />
        </div>
        <div>
          <div className="finding-card__meta">
            <span>Possible match</span>
            {isLatest ? <span className="new-badge">Latest</span> : null}
            <time dateTime={finding.finding.createdAt}>
              {dayjs(finding.finding.createdAt).format('MMM D, HH:mm')}
            </time>
          </div>
          <h3>{finding.finding.title}</h3>
        </div>
      </header>

      <p className="finding-card__content">{finding.finding.content}</p>

      <div className="finding-card__chips">
        <span>
          <Route size={13} />
          {finding.sources.length} source {finding.sources.length === 1 ? 'message' : 'messages'}
        </span>
        <span>Sample participant data</span>
      </div>

      {finding.sources.length || finding.outboundMessages.length ? (
        <details className="finding-explanation">
          <summary>
            <span>Why this reached you</span>
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
                        <strong>
                          {source.actorAgentId
                            ? agentById.get(source.actorAgentId)?.name
                              ?? 'Unknown agent'
                            : 'System'}
                        </strong>
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
            Was this useful? Tell Lucid what it understood or missed.
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
