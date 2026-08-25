import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  MessageSquareText,
  Send,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HostedConversationAnswer } from './hosted-conversation-answer';
import { HostedConversationHistory } from './hosted-conversation-history';
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

export function HostedConversation() {
  const [prompt, setPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerStatus, setAnswerStatus] = useState<
    HostedConversationTurn['status']
  >('completed');
  const [status, setStatus] = useState('Ready');
  const [progress, setProgress] = useState<HostedConversationProgressItem[]>([]);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [activeInvocationId, setActiveInvocationId] = useState<string>();
  const active = useRef<AbortController | undefined>(undefined);
  const history = useHostedConversationHistory();

  useEffect(() => () => active.current?.abort(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = prompt.trim();
    const accessToken = getHostedAccessToken();
    if (!candidate) {
      setError('Ask a question about your workspace.');
      return;
    }
    if (!accessToken) {
      setError('Reopen the workspace with your user access token.');
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    setActiveInvocationId(undefined);
    setSubmittedPrompt(candidate);
    setAnswer('');
    setAnswerStatus('completed');
    setProgress([]);
    setError('');
    setRunning(true);
    setStatus('Starting an isolated agent workspace');
    try {
      for await (const item of hostedConversations.streamTurn({
        prompt: candidate,
        accessToken,
        signal: controller.signal,
      })) {
        if (item.kind === 'accepted') {
          setActiveInvocationId(item.invocationId);
          setStatus('Agent workspace ready');
        } else if (item.kind === 'activity') {
          const presentation = presentHostedConversationActivity(item.activity);
          setStatus(presentation.status);
          const progressItem = presentation.progress;
          if (progressItem) {
            setProgress((current) => mergeHostedConversationProgress(
              current,
              progressItem,
            ));
          }
        } else if (item.kind === 'result') {
          const presentation = presentHostedConversationResult(item.result);
          setAnswer(presentation.answerMarkdown);
          setAnswerStatus(presentation.status);
          setStatus(describeOutcome(item.result.outcome));
        } else if (item.kind === 'cancelled') {
          setStatus('Cancelled');
        } else {
          setError(item.error.message);
          setStatus('Could not complete');
        }
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        setStatus('Cancelled');
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The hosted conversation could not complete.',
        );
        setStatus('Could not complete');
      }
    } finally {
      if (active.current === controller) {
        active.current = undefined;
      }
      setRunning(false);
      void history.refetch();
    }
  };

  return (
    <section className="hosted-conversation-card" id="conversation">
      <header className="card-heading">
        <span className="card-heading__icon" aria-hidden="true">
          <MessageSquareText size={19} />
        </span>
        <div>
          <p className="section-label">Hosted conversation</p>
          <h2 className="text-balance">Ask your agent directly.</h2>
          <p className="text-pretty">
            A Heddle agent runs in an isolated AgentCore workspace and can read
            only the Lucid capabilities granted for this turn.
          </p>
        </div>
      </header>

      <form className="hosted-conversation-form" onSubmit={submit}>
        <label htmlFor="hosted-conversation-prompt">Question</label>
        <textarea
          aria-describedby={error ? 'hosted-conversation-error' : undefined}
          aria-invalid={Boolean(error)}
          disabled={running}
          id="hosted-conversation-prompt"
          maxLength={MAX_PROMPT_CHARACTERS}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What should I know about my current workspace?"
          rows={4}
          value={prompt}
        />
        {error ? (
          <p
            className="hosted-conversation-error"
            id="hosted-conversation-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <footer>
          <span className="tabular-nums">
            {prompt.length.toLocaleString()} / {MAX_PROMPT_CHARACTERS.toLocaleString()}
          </span>
          <div>
            {running ? (
              <Button
                onClick={() => active.current?.abort()}
                type="button"
                variant="secondary"
              >
                <Square size={13} />
                Cancel
              </Button>
            ) : null}
            <Button disabled={running || !prompt.trim()} type="submit">
              <Send size={14} />
              {running ? 'Working…' : 'Ask agent'}
            </Button>
          </div>
        </footer>
      </form>

      {submittedPrompt || answer || running ? (
        <section className="hosted-conversation-result">
          <header aria-live="polite">
            <span className={running ? 'hosted-conversation-status--active' : ''} />
            <strong>{status}</strong>
          </header>
          {submittedPrompt ? (
            <p className="hosted-conversation-question">{submittedPrompt}</p>
          ) : null}
          {progress.length > 0 ? (
            <section
              className="hosted-conversation-progress"
              aria-label="Live agent activity"
              aria-live="polite"
            >
              <h3>Live agent activity</h3>
              <ol>
                {progress.map((item) => (
                  <li data-kind={item.kind} key={item.id}>
                    <span aria-hidden="true" />
                    <p>{item.text}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {answer ? (
            <HostedConversationAnswer
              markdown={answer}
              status={answerStatus}
            />
          ) : null}
        </section>
      ) : (
        <p className="hosted-conversation-empty text-pretty">
          Start with a bounded read-only question. The first pilot capability
          lets the agent inspect your user-scoped workspace snapshot.
        </p>
      )}

      <HostedConversationHistory
        activeInvocationId={activeInvocationId}
        error={history.error}
        isPending={history.isPending}
        onRetry={() => history.refetch()}
        turns={history.data ?? []}
      />
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
