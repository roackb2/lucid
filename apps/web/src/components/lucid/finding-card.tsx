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
import type { FindingView } from '@/lib/trpc';

type FindingCardProps = {
  finding: FindingView;
  isLatest: boolean;
  isSubmitting: boolean;
  onFeedback(findingSequence: number, content: string): Promise<unknown>;
};

type FindingSource = FindingView['sources'][number];

export function FindingCard({
  finding,
  isLatest,
  isSubmitting,
  onFeedback,
}: FindingCardProps) {
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [explanationOpen, setExplanationOpen] = useState(isLatest);
  const sourceDescription = describeSourceMix(finding.originatingSources);
  const originatingSequences = new Set(
    finding.originatingSources.map(({ message }) => message.sequence),
  );
  const relayCount = finding.sources.filter(({ message }) => (
    !originatingSequences.has(message.sequence)
  )).length;
  const directSourcesDiffer = relayCount > 0
    || finding.sources.length !== finding.originatingSources.length;

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
            <span>{finding.noMatch ? 'Completed check' : 'Finding'}</span>
            {isLatest ? <span className="new-badge">Latest</span> : null}
            <time dateTime={finding.finding.createdAt}>
              {dayjs(finding.finding.createdAt).format('MMM D, HH:mm')}
            </time>
          </div>
          <h3>
            {finding.noMatch
              ? 'No relevant message surfaced in this check'
              : finding.origin === 'request-thread'
                ? 'A response to your request may be relevant'
                : 'An existing network message may be relevant'}
          </h3>
        </div>
      </header>

      <p className="finding-card__content">{finding.finding.content}</p>

      <div className="finding-card__chips">
        <span>
          <Route size={13} />
          {finding.sources.length} delivered {finding.sources.length === 1 ? 'message' : 'messages'}
        </span>
        <span>
          {finding.origin === 'request-thread'
            ? 'Response to your request'
            : 'Found in existing network mail'}
        </span>
        <span>{sourceDescription}</span>
        {relayCount ? (
          <span>
            {relayCount} {relayCount === 1 ? 'relay' : 'relays'} preserved
          </span>
        ) : null}
      </div>

      {finding.originatingSources.length
      || finding.sources.length
      || finding.outboundMessages.length ? (
        <details
          className="finding-explanation"
          onToggle={(event) => setExplanationOpen(event.currentTarget.open)}
          open={explanationOpen}
        >
          <summary>
            <span>
              {finding.origin === 'request-thread'
                ? 'See the request and responses behind this finding'
                : 'See the network messages behind this finding'}
            </span>
            <ChevronDown size={15} />
          </summary>
          <div className="finding-explanation__content">
            {finding.originatingSources.length ? (
              <section>
                <h4>Originating network contributions</h4>
                <SourceMessageList sources={finding.originatingSources} />
              </section>
            ) : null}
            {directSourcesDiffer && finding.sources.length ? (
              <section>
                <h4>Messages your agent directly used</h4>
                <SourceMessageList sources={finding.sources} />
              </section>
            ) : null}
            {finding.outboundMessages.length ? (
              <section>
                <h4>What your agent shared while looking</h4>
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
              Originating contributions collapse cited relays back to the
              user messages behind them. Event references establish
              provenance and delivery, not whether content is true or useful.
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
          <small>Your agent receives this during its next wake.</small>
        </section>
      ) : (
        <form className="finding-feedback" onSubmit={submitFeedback}>
          <label htmlFor={`finding-feedback-${finding.finding.sequence}`}>
            {finding.noMatch
              ? 'Was reporting no match the right choice?'
              : 'Was this useful? Tell your agent what it understood or missed.'}
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

function describeSourceMix(sources: FindingSource[]): string {
  const users = new Map(sources.flatMap(({ attribution }) => (
    attribution ? [[attribution.userId, attribution] as const] : []
  )));
  const sourceKinds = new Set(
    [...users.values()].map(({ userKind }) => userKind),
  );

  if (sourceKinds.has('human') && sourceKinds.has('synthetic')) {
    return 'Human and synthetic users';
  }
  if (sourceKinds.has('human')) {
    return users.size === 1
      ? '1 human user'
      : `${users.size} human users`;
  }
  if (sourceKinds.has('synthetic')) {
    return users.size === 1
      ? '1 synthetic user'
      : `${users.size} synthetic users`;
  }
  return sources.length ? 'Network contribution' : 'No originating contribution';
}

function SourceMessageList({ sources }: { sources: FindingSource[] }) {
  return (
    <ol>
      {sources.map(({ message, attribution }) => (
        <li key={message.id}>
          <span>#{message.sequence}</span>
          <div>
            <div className="source-message__identity">
              <strong>
                {attribution?.userDisplayName
                  ?? attribution?.agentName
                  ?? 'Network user'}
              </strong>
              <SourceKindBadge source={{ message, attribution }} />
            </div>
            <p>{message.content}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SourceKindBadge({ source }: { source: FindingSource }) {
  const kind = source.attribution?.userKind;
  if (!kind) {
    return null;
  }
  return (
    <span className={
      kind === 'human'
        ? 'source-badge source-badge--real'
        : 'source-badge'
    }>
      {kind === 'human' ? 'Human user' : 'Synthetic user'}
    </span>
  );
}
