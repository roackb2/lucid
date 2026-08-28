import dayjs from 'dayjs';
import { RefreshCw } from 'lucide-react';
import {
  Message,
  MessageContent,
} from '@/components/ai-elements/message';
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
  const chronologicalTurns = orderHostedConversationTurns(visibleTurns);
  const hasCachedTurns = turns.length > 0;

  return (
    <>
      {isPending && !hasCachedTurns ? (
        <p className="hosted-conversation-history__state">
          Restoring your conversation…
        </p>
      ) : error && !hasCachedTurns ? (
        <div className="hosted-conversation-history__state" role="alert">
          <p>Lucid could not restore this conversation.</p>
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

      {chronologicalTurns.length > 0 ? (
        <ol className="chat-thread__turns" aria-label="Saved conversation">
          {chronologicalTurns.map((turn) => (
            <li className="chat-thread__turn" key={turn.invocationId}>
              <HostedConversationUserMessage
                prompt={turn.prompt}
                requestedAt={turn.requestedAt}
              />
              {turn.summary ? (
                <HostedConversationAnswer
                  markdown={turn.summary}
                  status={turn.status}
                />
              ) : (
                <div
                  className="chat-message chat-message--agent chat-message--state"
                  data-status={turn.status}
                >
                  <strong>Agent</strong>
                  <p>{describeEmptyTerminal(turn.status)}</p>
                </div>
              )}
              <footer className="chat-thread__turn-meta">
                <span data-status={turn.status}>
                  {describeHostedConversationStatus(turn.status)}
                </span>
                <time dateTime={turn.settledAt ?? turn.requestedAt}>
                  {dayjs(turn.settledAt ?? turn.requestedAt).format('MMM D, HH:mm')}
                </time>
              </footer>
            </li>
          ))}
        </ol>
      ) : null}

      {error && hasCachedTurns ? (
        <div
          className="hosted-conversation-history__state hosted-conversation-history__state--refresh"
          role="alert"
        >
          <p>Lucid could not refresh the saved conversation.</p>
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
    </>
  );
}

export function HostedConversationUserMessage({
  prompt,
  requestedAt,
}: {
  prompt: string;
  requestedAt: string;
}) {
  return (
    <Message className="chat-message chat-message--user" from="user">
      <MessageContent>
        <span>You</span>
        <p>{prompt}</p>
        <time dateTime={requestedAt}>
          {dayjs(requestedAt).format('HH:mm')}
        </time>
      </MessageContent>
    </Message>
  );
}

export function orderHostedConversationTurns(
  turns: HostedConversationTurn[],
): HostedConversationTurn[] {
  return [...turns].sort((left, right) => (
    Date.parse(left.requestedAt) - Date.parse(right.requestedAt)
  ));
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
