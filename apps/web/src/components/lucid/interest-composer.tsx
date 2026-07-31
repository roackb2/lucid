import dayjs from 'dayjs';
import {
  PencilLine,
  RefreshCw,
  Save,
  Search,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { DiscoverySnapshot } from '@/lib/trpc';

type InterestComposerProps = {
  interest?: DiscoverySnapshot['interest'];
  lastCheckedAt?: string;
  isRunActive: boolean;
  isSaving: boolean;
  isStarting: boolean;
  onSaveInterest(content: string): Promise<unknown>;
  onStartRun(): void;
};

const EXAMPLE_INTERESTS = [
  'Product ideas that become possible when agents represent different people.',
  'People experimenting with AI music as a craft, not a content faucet.',
] as const;

export function InterestComposer({
  interest,
  lastCheckedAt,
  isRunActive,
  isSaving,
  isStarting,
  onSaveInterest,
  onStartRun,
}: InterestComposerProps) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const showEditor = !interest || editing;

  const submitInterest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) {
      return;
    }
    try {
      await onSaveInterest(content);
    } catch {
      return;
    }
    setDraft('');
    setEditing(false);
  };

  const beginEditing = () => {
    setDraft(interest?.content ?? '');
    setEditing(true);
  };

  return (
    <section className="interest-card" id="interest">
      <header className="card-heading">
        <div className="card-heading__icon" aria-hidden="true">
          <Search size={18} />
        </div>
        <div>
          <p className="section-label">Saved interest</p>
          <h2>What should Lucid look for?</h2>
          <p>
            Describe an ongoing need, taste, or question in ordinary language.
            Only your agent receives the full text.
          </p>
        </div>
      </header>

      {showEditor ? (
        <form className="interest-form" onSubmit={submitInterest}>
          <label htmlFor="saved-interest">
            What would be useful for you to discover?
          </label>
          <textarea
            autoFocus={editing}
            id="saved-interest"
            maxLength={1_600}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="For example: I want to meet people building..."
            rows={6}
            value={draft}
          />
          {!interest ? (
            <div className="example-interests">
              <span>Try with the available sample participants</span>
              {EXAMPLE_INTERESTS.map((example) => (
                <button
                  key={example}
                  onClick={() => setDraft(example)}
                  type="button"
                >
                  {example}
                </button>
              ))}
            </div>
          ) : null}
          <footer className="interest-form__footer">
            <span>{draft.length} / 1600</span>
            <div>
              {interest ? (
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
                disabled={!draft.trim() || isSaving || isRunActive}
                size="small"
                type="submit"
              >
                <Save size={14} />
                {interest ? 'Save changes' : 'Save interest'}
              </Button>
            </div>
          </footer>
        </form>
      ) : (
        <div className="saved-interest">
          <p>{interest.content}</p>
          <div>
            <span>
              Updated {dayjs(interest.createdAt).format('MMM D, HH:mm')}
            </span>
            <button
              disabled={isRunActive}
              onClick={beginEditing}
              type="button"
            >
              <PencilLine size={13} />
              Edit
            </button>
          </div>
        </div>
      )}

      <footer className="check-controls">
        <div>
          <strong>
            {lastCheckedAt
              ? `Last checked ${dayjs(lastCheckedAt).format('MMM D, HH:mm')}`
              : 'Not checked yet'}
          </strong>
          <p>
            Checks are manual in this prototype. One check takes about a minute
            and compares this interest with the available participant sources.
          </p>
        </div>
        <Button
          disabled={!interest || isRunActive || isStarting || editing}
          onClick={onStartRun}
        >
          <RefreshCw size={15} />
          Check for discoveries
        </Button>
      </footer>
    </section>
  );
}
