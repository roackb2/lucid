import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  MessageCircle,
  Send,
  Square,
} from 'lucide-react';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Button } from '@/components/ui/button';
import { HostedConversationAnswer } from './hosted-conversation-answer';
import {
  HostedConversationHistory,
  HostedConversationUserMessage,
} from './hosted-conversation-history';
import {
  mergeHostedConversationProgress,
  presentHostedConversationActivity,
  type HostedConversationProgressItem,
} from '@/components/lucid/hosted-conversation-progress';
import {
  HostedConversationClient,
} from '@heddleagent/execution-host-client/adopter';
import {
  getHostedAccessToken,
  type HostedConversationTurn,
} from '@/lib/trpc';
import type { ExecutionHostStreamEvent } from '@heddleagent/execution-host-client/contracts';
import {
  useHostedConversationHistory,
} from '@/hooks/use-hosted-conversation-history';

const MAX_PROMPT_CHARACTERS = 20_000;
const hostedConversations = new HostedConversationClient();

type LiveConversationTurn = {
  answer: string;
  answerStatus: HostedConversationTurn['status'];
  error: string;
  invocationId?: string;
  progress: HostedConversationProgressItem[];
  prompt: string;
  requestedAt: string;
  running: boolean;
  status: string;
};

export function useHostedConversation() {
  const [draft, setDraft] = useState('');
  const [composerError, setComposerError] = useState('');
  const [liveTurn, setLiveTurn] = useState<LiveConversationTurn>();
  const active = useRef<AbortController | undefined>(undefined);
  const history = useHostedConversationHistory();

  useEffect(() => () => active.current?.abort(), []);

  const submit = async () => {
    if (active.current) {
      return;
    }
    const candidate = draft.trim();
    const accessToken = getHostedAccessToken();
    if (!candidate) {
      setComposerError('Ask a question about your Lucid workspace.');
      return;
    }
    if (!accessToken) {
      setComposerError('Sign in again before starting a Chat turn.');
      return;
    }

    const controller = new AbortController();
    let terminalReceived = false;
    active.current = controller;
    setComposerError('');
    setDraft('');
    setLiveTurn({
      answer: '',
      answerStatus: 'completed',
      error: '',
      progress: [],
      prompt: candidate,
      requestedAt: new Date().toISOString(),
      running: true,
      status: 'Connecting to your agent',
    });

    try {
      for await (const item of hostedConversations.streamTurn({
        prompt: candidate,
        accessToken,
        signal: controller.signal,
      })) {
        if (item.kind === 'accepted') {
          setLiveTurn((current) => current ? {
            ...current,
            invocationId: item.invocationId,
            status: 'Agent workspace ready',
          } : current);
        } else if (item.kind === 'activity') {
          const presentation = presentHostedConversationActivity(item.activity);
          setLiveTurn((current) => current ? {
            ...current,
            progress: presentation.progress
              ? mergeHostedConversationProgress(
                current.progress,
                presentation.progress,
              )
              : current.progress,
            status: presentation.status,
          } : current);
        } else if (item.kind === 'result') {
          terminalReceived = true;
          const presentation = presentHostedConversationResult(item.result);
          setLiveTurn((current) => current ? {
            ...current,
            answer: presentation.answerMarkdown,
            answerStatus: presentation.status,
            running: false,
            status: describeOutcome(item.result.outcome),
          } : current);
        } else if (item.kind === 'cancelled') {
          terminalReceived = true;
          setLiveTurn((current) => current ? {
            ...current,
            answerStatus: 'cancelled',
            running: false,
            status: 'Cancelled',
          } : current);
        } else {
          terminalReceived = true;
          setLiveTurn((current) => current ? {
            ...current,
            answerStatus: 'failed',
            error: item.error.message,
            running: false,
            status: 'Could not complete',
          } : current);
        }
      }

      if (!terminalReceived && !controller.signal.aborted) {
        setLiveTurn((current) => current ? {
          ...current,
          answerStatus: 'interrupted',
          error: 'The connection ended before Lucid received a final answer.',
          running: false,
          status: 'Connection interrupted',
        } : current);
      }
    } catch (cause) {
      setLiveTurn((current) => current ? {
        ...current,
        answerStatus: controller.signal.aborted ? 'cancelled' : 'failed',
        error: controller.signal.aborted
          ? ''
          : cause instanceof Error
            ? cause.message
            : 'The hosted conversation could not complete.',
        running: false,
        status: controller.signal.aborted ? 'Cancelled' : 'Could not complete',
      } : current);
    } finally {
      if (active.current === controller) {
        active.current = undefined;
      }
      setLiveTurn((current) => current ? { ...current, running: false } : current);
      await history.refetch();
    }
  };

  return {
    cancel: () => active.current?.abort(),
    composerError,
    draft,
    history,
    liveTurn,
    setDraft,
    submit,
  };
}

export type HostedConversationController = ReturnType<
  typeof useHostedConversation
>;

export function HostedConversation({
  composerRef,
  controller,
}: {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  controller: HostedConversationController;
}) {
  const {
    cancel,
    composerError,
    draft,
    history,
    liveTurn,
    setDraft,
    submit,
  } = controller;
  const hasSavedTurns = (history.data?.length ?? 0) > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter'
      && !event.shiftKey
      && !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <section className="hosted-conversation" aria-label="Chat with Lucid">
      <Conversation className="chat-thread">
        <ConversationContent className="chat-thread__content">
          <HostedConversationHistory
            activeInvocationId={liveTurn?.invocationId}
            error={history.error}
            isPending={history.isPending}
            onRetry={() => history.refetch()}
            turns={history.data ?? []}
          />
          {!hasSavedTurns && !liveTurn && !history.isPending && !history.error ? (
            <ConversationEmptyState
              className="chat-thread__empty"
              description="Ask about your current Interest, Agent activity, or Findings. Ordinary Chat cannot change them."
              icon={<MessageCircle aria-hidden="true" />}
              title="Start a conversation"
            />
          ) : null}
          {liveTurn ? (
            <ol className="chat-thread__turns chat-thread__turns--live">
              <li className="chat-thread__turn">
                <HostedConversationUserMessage
                  prompt={liveTurn.prompt}
                  requestedAt={liveTurn.requestedAt}
                />
                <section
                  aria-live="polite"
                  className="hosted-conversation-progress"
                  data-running={liveTurn.running}
                >
                  <header>
                    <span aria-hidden="true" />
                    <strong>{liveTurn.status}</strong>
                  </header>
                  {liveTurn.progress.length > 0 ? (
                    <ol aria-label="Live agent activity">
                      {liveTurn.progress.map((item) => (
                        <li data-kind={item.kind} key={item.id}>
                          <span aria-hidden="true" />
                          <p>{item.text}</p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {liveTurn.error ? (
                    <p className="hosted-conversation-error" role="alert">
                      {liveTurn.error}
                    </p>
                  ) : null}
                </section>
                {liveTurn.answer ? (
                  <HostedConversationAnswer
                    markdown={liveTurn.answer}
                    status={liveTurn.answerStatus}
                  />
                ) : null}
              </li>
            </ol>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <label htmlFor="hosted-conversation-prompt">Message your Agent</label>
        <div className="chat-composer__frame">
          <textarea
            aria-describedby={composerError
              ? 'hosted-conversation-error'
              : 'hosted-conversation-help'}
            aria-invalid={Boolean(composerError)}
            disabled={liveTurn?.running}
            id="hosted-conversation-prompt"
            maxLength={MAX_PROMPT_CHARACTERS}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask about your Lucid workspace…"
            ref={composerRef}
            rows={3}
            value={draft}
          />
          {liveTurn?.running ? (
            <Button
              aria-label="Cancel current Chat turn"
              onClick={cancel}
              size="icon"
              type="button"
              variant="secondary"
            >
              <Square aria-hidden="true" />
            </Button>
          ) : (
            <Button
              aria-label="Send message"
              disabled={!draft.trim()}
              size="icon"
              type="submit"
            >
              <Send aria-hidden="true" />
            </Button>
          )}
        </div>
        {composerError ? (
          <p
            className="hosted-conversation-error"
            id="hosted-conversation-error"
            role="alert"
          >
            {composerError}
          </p>
        ) : null}
        <footer id="hosted-conversation-help">
          <span>Enter to send · Shift+Enter for a new line</span>
          <span className="tabular-nums">
            {draft.length.toLocaleString()} / {MAX_PROMPT_CHARACTERS.toLocaleString()}
          </span>
        </footer>
      </form>
    </section>
  );
}

function describeOutcome(
  outcome: 'done' | 'max_steps' | 'error' | 'interrupted',
): string {
  return {
    done: 'Complete',
    max_steps: 'Stopped at the step limit',
    error: 'Could not complete',
    interrupted: 'Interrupted',
  }[outcome];
}

type HostedConversationResult = Extract<
  ExecutionHostStreamEvent,
  { kind: 'result' }
>['result'];

export function presentHostedConversationResult(
  result: HostedConversationResult,
): {
  answerMarkdown: string;
  status: HostedConversationTurn['status'];
} {
  const status = {
    done: 'completed',
    max_steps: 'max_steps',
    error: 'failed',
    interrupted: 'interrupted',
  } as const;
  const emptyAnswer = {
    done: 'The agent completed without a written summary.',
    max_steps: 'The agent stopped at the step limit without a written summary.',
    error: 'The agent could not complete this question.',
    interrupted: 'This conversation ended before Lucid received a terminal answer.',
  } as const;
  return {
    answerMarkdown: result.summary ?? emptyAnswer[result.outcome],
    status: status[result.outcome],
  };
}
