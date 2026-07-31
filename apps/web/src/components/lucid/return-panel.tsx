import dayjs from 'dayjs';
import {
  CornerDownRight,
  MessageSquareText,
  Moon,
  Route,
  Send,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { AgentView, ReturnView } from '@/lib/trpc';

type ReturnPanelProps = {
  agents: AgentView[];
  value?: ReturnView;
  isSubmitting: boolean;
  onFeedback(returnSequence: number, content: string): void;
};

export function ReturnPanel({
  agents,
  value,
  isSubmitting,
  onFeedback,
}: ReturnPanelProps) {
  const [feedback, setFeedback] = useState('');
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  if (!value) {
    return (
      <article className="return-panel return-panel--empty">
        <header className="panel-heading">
          <div className="panel-icon" aria-hidden="true">
            <Route size={18} />
          </div>
          <div>
            <p className="eyebrow">Nothing has returned yet</p>
            <h3>The first encounter begins with an intent</h3>
          </div>
        </header>
        <div className="empty-return">
          <div className="empty-return__orbit" aria-hidden="true">
            <span />
            <i>✦</i>
          </div>
          <p>
            A return is allowed to contain one peer-sourced encounter—or an
            explicit choice not to interrupt you.
          </p>
        </div>
      </article>
    );
  }

  const submitFeedback = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = feedback.trim();
    if (!content) {
      return;
    }
    onFeedback(value.event.sequence, content);
    setFeedback('');
  };

  return (
    <article className={`return-panel ${value.quiet ? 'return-panel--quiet' : ''}`}>
      <header className="panel-heading return-heading">
        <div className={`panel-icon ${value.quiet ? '' : 'panel-icon--gold'}`} aria-hidden="true">
          {value.quiet ? <Moon size={18} /> : <Route size={18} />}
        </div>
        <div>
          <p className="eyebrow">
            {value.quiet ? 'A quiet return' : 'One encounter came home'}
          </p>
          <h3>{value.event.title}</h3>
        </div>
        <time dateTime={value.event.createdAt}>
          {dayjs(value.event.createdAt).format('MMM D · HH:mm')}
        </time>
      </header>

      <div className="return-content">
        <p>{value.event.content}</p>
      </div>

      {value.sources.length ? (
        <section className="source-path" aria-labelledby="source-path-title">
          <div>
            <Route size={14} />
            <h4 id="source-path-title">What actually reached Aster</h4>
          </div>
          <ol>
            {value.sources.map((source) => (
              <li key={source.id}>
                <span>#{source.sequence}</span>
                <div>
                  <strong>
                    {source.actorAgentId
                      ? agentsById.get(source.actorAgentId)?.name ?? 'Unknown agent'
                      : 'Network'}
                  </strong>
                  <p>{source.content}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {value.disclosures.length ? (
        <details className="disclosure-audit">
          <summary>
            <CornerDownRight size={14} />
            What Aster revealed along the way
          </summary>
          <ul>
            {value.disclosures.map((event) => (
              <li key={event.id}>
                <span>#{event.sequence}</span>
                {event.content}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {value.feedback ? (
        <section className="feedback-record">
          <div>
            <MessageSquareText size={14} />
            <span>Your correction</span>
          </div>
          <blockquote>{value.feedback.content}</blockquote>
          <p>Aster will receive this privately on the next journey.</p>
        </section>
      ) : (
        <form className="feedback-form" onSubmit={submitFeedback}>
          <label htmlFor="return-feedback">
            {value.quiet
              ? 'Was staying quiet the right choice? What should Aster change?'
              : 'Was this useful? What did Aster understand correctly or miss?'}
          </label>
          <textarea
            id="return-feedback"
            maxLength={1_600}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Respond in ordinary language…"
            rows={4}
            value={feedback}
          />
          <div>
            <span>{feedback.length} / 1600 · private feedback</span>
            <Button
              disabled={!feedback.trim() || isSubmitting}
              size="small"
              type="submit"
            >
              <Send size={13} />
              Send correction
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}
