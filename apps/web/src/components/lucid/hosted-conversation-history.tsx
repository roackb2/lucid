import dayjs from 'dayjs';
import { ChevronDown, History, RefreshCw } from 'lucide-react';
import { HostedConversationAnswer } from './hosted-conversation-answer';
import { Button } from '@/components/ui/button';
import type { HostedConversationTurn } from '@/lib/trpc';

export function HostedConversationHistory({
  activeInvocationId,
  error,
  isPending,
  onRetry,
  turns,
}: {
  activeInvocationId?: string;
  error?: Error | null;
  isPending: boolean;
  onRetry: () => unknown;
  turns: HostedConversationTurn[];
}) {
  const visibleTurns = turns.filter(
    ({ invocationId }) => invocationId !== activeInvocationId,
  );
  const hasCachedTurns = turns.length > 0;

  return (
    <section className="hosted-conversation-history" aria-label="Recent conversations">
      <header>
        <div>
          <History size={15} />
          <h3>Recent conversations</h3>
        </div>
        <span>Saved for your account</span>
      </header>

      {isPending ? (
        <p className="hosted-conversation-history__state">
          Loading recent conversations…
        </p>
      ) : error && !hasCachedTurns ? (
        <div className="hosted-conversation-history__state" role="alert">
          <p>Lucid could not load recent conversations.</p>
          <Button
            onClick={() => void onRetry()}
            size="small"
            type="button"
            variant="secondary"
          >
            <RefreshCw size={13} />
            Try again
          </Button>
        </div>
      ) : visibleTurns.length === 0 ? (
        <p className="hosted-conversation-history__state">
          Conversation results will remain available here after you return.
        </p>
      ) : (
        <ol>
          {visibleTurns.map((turn, index) => (
            <li key={turn.invocationId}>
              <details open={index === 0}>
                <summary>
                  <span
                    className="hosted-conversation-history__status"
                    data-status={turn.status}
                  >
                    {describeHostedConversationStatus(turn.status)}
                  </span>
                  <strong>{turn.prompt}</strong>
                  <time dateTime={turn.requestedAt}>
                    {dayjs(turn.requestedAt).format('MMM D, HH:mm')}
                  </time>
                  <ChevronDown
                    aria-hidden="true"
                    className="hosted-conversation-history__chevron"
                    size={14}
                  />
                </summary>
                <div className="hosted-conversation-history__content">
                  {turn.summary ? (
                    <HostedConversationAnswer
                      markdown={turn.summary}
                      status={turn.status}
                    />
                  ) : (
                    <p>{describeEmptyTerminal(turn.status)}</p>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
      {error && hasCachedTurns ? (
        <div
          className="hosted-conversation-history__state hosted-conversation-history__state--refresh"
          role="alert"
        >
          <p>Lucid could not refresh recent conversations.</p>
          <Button
            onClick={() => void onRetry()}
            size="small"
            type="button"
            variant="secondary"
          >
            <RefreshCw size={13} />
            Try again
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function describeHostedConversationStatus(
  status: HostedConversationTurn['status'],
): string {
  return {
    requested: 'Starting',
    running: 'Working',
    completed: 'Complete',
    max_steps: 'Step limit',
    failed: 'Could not complete',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
  }[status];
}

function describeEmptyTerminal(
  status: HostedConversationTurn['status'],
): string {
  return {
    requested: 'Lucid is preparing this agent workspace.',
    running: 'The agent is still working on this question.',
    completed: 'The agent completed without a written summary.',
    max_steps: 'The agent stopped at its step limit without a written summary.',
    failed: 'The agent could not complete this question.',
    cancelled: 'This conversation was cancelled.',
    interrupted: 'This conversation ended before Lucid received a terminal answer.',
  }[status];
}
