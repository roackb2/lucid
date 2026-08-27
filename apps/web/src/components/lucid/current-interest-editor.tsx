import dayjs from 'dayjs';
import { Lightbulb, PencilLine, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { DiscoverySnapshot } from '@/lib/trpc';

type CurrentInterestEditorProps = {
  interest?: DiscoverySnapshot['interest'];
  isSaving: boolean;
  onSave(content: string): Promise<unknown>;
};

/** Edits the one current Interest supported by the discovery workspace. */
export function CurrentInterestEditor({
  interest,
  isSaving,
  onSave,
}: CurrentInterestEditorProps) {
  const [draft, setDraft] = useState(interest?.content ?? '');
  const [editing, setEditing] = useState(!interest);
  const [errorMessage, setErrorMessage] = useState<string>();
  const showEditor = !interest || editing;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSaving) {
      return;
    }

    setErrorMessage(undefined);
    try {
      await onSave(content);
      setEditing(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Lucid could not save the current interest.',
      );
    }
  };

  const beginEditing = () => {
    setDraft(interest?.content ?? '');
    setErrorMessage(undefined);
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(interest?.content ?? '');
    setErrorMessage(undefined);
    setEditing(false);
  };

  return (
    <section
      aria-labelledby="current-interest-title"
      className="current-interest"
    >
      <header className="current-interest__header">
        <span className="current-interest__icon" aria-hidden="true">
          <Lightbulb />
        </span>
        <div>
          <span>Current interest</span>
          <h2 id="current-interest-title">
            {interest ? 'What Lucid is looking for' : 'Set what Lucid should look for'}
          </h2>
          <p>
            Keep one enduring question, need, or area of curiosity in focus.
            You can refine it as the experiment evolves.
          </p>
        </div>
        {interest && !showEditor ? (
          <Button onClick={beginEditing} size="small" variant="secondary">
            <PencilLine aria-hidden="true" />
            Edit current interest
          </Button>
        ) : null}
      </header>

      {showEditor ? (
        <form
          aria-busy={isSaving}
          className="current-interest__form"
          onSubmit={submit}
        >
          <label htmlFor="current-interest-content">
            What would be useful for you to discover?
          </label>
          <textarea
            aria-describedby="current-interest-help current-interest-count"
            autoFocus
            id="current-interest-content"
            maxLength={1_600}
            onChange={(event) => {
              setDraft(event.target.value);
              setErrorMessage(undefined);
            }}
            placeholder="For example: Find people, projects, or ideas that could improve…"
            rows={7}
            value={draft}
          />
          <p className="current-interest__hint" id="current-interest-help">
            Saving replaces the current focus; it does not create a second
            Interest. Earlier Findings and evidence remain available.
          </p>
          {errorMessage ? (
            <p className="current-interest__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <footer className="current-interest__form-footer">
            <span className="tabular-nums" id="current-interest-count">
              {draft.length} / 1600
            </span>
            <div>
              {interest ? (
                <Button
                  disabled={isSaving}
                  onClick={cancelEditing}
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
                <Save aria-hidden="true" />
                {isSaving
                  ? 'Saving…'
                  : interest
                    ? 'Save changes'
                    : 'Set current interest'}
              </Button>
            </div>
          </footer>
        </form>
      ) : (
        <div className="current-interest__saved">
          <p>{interest.content}</p>
          <footer>
            <span>
              Updated {dayjs(interest.createdAt).format('MMM D, YYYY · HH:mm')}
            </span>
            <span>One current Interest</span>
          </footer>
        </div>
      )}
    </section>
  );
}
