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
import {
  streamHostedConversation,
} from '@/lib/hosted-conversation-client';
import { getHostedAccessToken } from '@/lib/trpc';

const MAX_PROMPT_CHARACTERS = 20_000;

export function HostedConversation() {
  const [prompt, setPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);

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
    setSubmittedPrompt(candidate);
    setAnswer('');
    setError('');
    setRunning(true);
    setStatus('Starting an isolated agent workspace');
    try {
      for await (const item of streamHostedConversation({
        prompt: candidate,
        accessToken,
        signal: controller.signal,
      })) {
        if (item.kind === 'accepted') {
          setStatus('Agent workspace ready');
        } else if (item.kind === 'activity') {
          setStatus(describeActivity(item.activity));
        } else if (item.kind === 'result') {
          setAnswer(
            item.result.summary
              ?? 'The agent completed without a written summary.',
          );
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
        <section className="hosted-conversation-result" aria-live="polite">
          <header>
            <span className={running ? 'hosted-conversation-status--active' : ''} />
            <strong>{status}</strong>
          </header>
          {submittedPrompt ? (
            <p className="hosted-conversation-question">{submittedPrompt}</p>
          ) : null}
          {answer ? (
            <div className="hosted-conversation-answer">
              <span>Agent</span>
              <p>{answer}</p>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="hosted-conversation-empty text-pretty">
          Start with a bounded read-only question. The first pilot capability
          lets the agent inspect your user-scoped workspace snapshot.
        </p>
      )}
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

function describeActivity(activity: unknown): string {
  if (!activity || typeof activity !== 'object' || !('type' in activity)) {
    return 'Agent is working';
  }
  const type = activity.type;
  if (type === 'tool.calling' || type === 'tool.completed') {
    return 'Reading your Lucid workspace';
  }
  if (
    type === 'assistant.stream'
    || type === 'assistant.commentary'
    || type === 'reasoning.summary'
  ) {
    return 'Composing the answer';
  }
  if (type === 'loop.finished') {
    return 'Finishing the turn';
  }
  return 'Agent is working';
}
