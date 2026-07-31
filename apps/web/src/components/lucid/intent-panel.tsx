import dayjs from 'dayjs';
import {
  ArrowUpRight,
  PencilLine,
  Send,
  Sparkles,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { LucidSnapshot } from '@/lib/trpc';

type IntentPanelProps = {
  agentName: string;
  intent?: LucidSnapshot['intent'];
  isActive: boolean;
  isSaving: boolean;
  isStarting: boolean;
  onSetIntent(content: string): void;
  onStartJourney(): void;
};

const LAB_PROMPTS = [
  'I want to notice product ideas that only make sense when agents represent different people.',
  'I want to meet people experimenting with AI music as a craft, not a content faucet.',
] as const;

export function IntentPanel({
  agentName,
  intent,
  isActive,
  isSaving,
  isStarting,
  onSetIntent,
  onStartJourney,
}: IntentPanelProps) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const showEditor = !intent || editing;

  const submitIntent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) {
      return;
    }
    onSetIntent(content);
    setDraft('');
    setEditing(false);
  };

  const beginEditing = () => {
    setDraft(intent?.content ?? '');
    setEditing(true);
  };

  return (
    <article className="intent-panel">
      <header className="panel-heading">
        <div className="panel-icon panel-icon--gold" aria-hidden="true">
          <Sparkles size={18} />
        </div>
        <div>
          <p className="eyebrow">What I am carrying</p>
          <h3>Your private intent</h3>
        </div>
      </header>

      {showEditor ? (
        <form className="intent-form" onSubmit={submitIntent}>
          <label htmlFor="principal-intent">
            What should {agentName} keep noticing while you are away?
          </label>
          <textarea
            autoFocus={editing}
            id="principal-intent"
            maxLength={1_600}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Something you care about over time, in your own words…"
            rows={7}
            value={draft}
          />
          <div className="intent-form__footer">
            <span>{draft.length} / 1600 · private to you and {agentName}</span>
            <div>
              {intent ? (
                <Button
                  onClick={() => {
                    setDraft('');
                    setEditing(false);
                  }}
                  size="small"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                disabled={!draft.trim() || isSaving || isActive}
                size="small"
                type="submit"
              >
                <Send size={14} />
                Give to {agentName}
              </Button>
            </div>
          </div>
          {!intent ? (
            <div className="lab-prompts">
              <span>Try the synthetic lab with:</span>
              {LAB_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setDraft(prompt)}
                  type="button"
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
        </form>
      ) : (
        <div className="intent-record">
          <blockquote>{intent.content}</blockquote>
          <footer>
            <span>
              Given {dayjs(intent.createdAt).format('MMM D · HH:mm')}
            </span>
            <button
              disabled={isActive}
              onClick={beginEditing}
              type="button"
            >
              <PencilLine size={13} />
              Revise privately
            </button>
          </footer>
        </div>
      )}

      <div className="journey-action">
        <div>
          <strong>One bounded journey</strong>
          <p>
            {agentName} seeks, two synthetic peers may respond, then {agentName}
            {' '}wakes once more to decide whether anything deserves your attention.
          </p>
        </div>
        <Button
          disabled={!intent || isActive || isStarting || editing}
          onClick={onStartJourney}
        >
          <ArrowUpRight size={16} />
          Let {agentName} wander
        </Button>
      </div>
    </article>
  );
}
