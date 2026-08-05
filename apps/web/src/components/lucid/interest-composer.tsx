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
  backgroundChecksEnabled: boolean;
  isChecking: boolean;
  isSaving: boolean;
  isRunningNow: boolean;
  onSaveInterest(content: string): Promise<unknown>;
  onRunNow(): void;
};

export function InterestComposer({
  interest,
  lastCheckedAt,
  backgroundChecksEnabled,
  isChecking,
  isSaving,
  isRunningNow,
  onSaveInterest,
  onRunNow,
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
                disabled={!draft.trim() || isSaving}
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
              ? `Last agent wake ${dayjs(lastCheckedAt).format('MMM D, HH:mm')}`
              : 'Waiting for the first agent wake'}
          </strong>
          <p>
            Saving changes automatically notifies your agent. Run now adds a
            fresh request without changing the scheduled background checks.
          </p>
        </div>
        <Button
          disabled={
            !interest
            || !backgroundChecksEnabled
            || isRunningNow
            || editing
          }
          onClick={onRunNow}
        >
          <span className={isChecking ? 'button-spinner' : ''}>
            <RefreshCw size={15} />
          </span>
          {isChecking ? 'Checking…' : 'Run a check now'}
        </Button>
      </footer>
    </section>
  );
}
