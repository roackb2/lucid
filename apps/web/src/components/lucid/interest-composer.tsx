import dayjs from 'dayjs';
import {
  AlertTriangle,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  Send,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { DiscoverySnapshot } from '@/lib/trpc';

type InterestComposerProps = {
  interest?: DiscoverySnapshot['interest'];
  networkActivity?: DiscoverySnapshot['networkActivity'];
  lastCheckedAt?: string;
  backgroundChecksEnabled: boolean;
  isChecking: boolean;
  isSaving: boolean;
  isRunningNow: boolean;
  isRetrying: boolean;
  failedTask?: DiscoverySnapshot['backgroundChecks']['tasks'][number];
  onSaveInterest(content: string): Promise<unknown>;
  onRunNow(): void;
  onRetry(): void;
};

export function InterestComposer({
  interest,
  networkActivity,
  lastCheckedAt,
  backgroundChecksEnabled,
  isChecking,
  isSaving,
  isRunningNow,
  isRetrying,
  failedTask,
  onSaveInterest,
  onRunNow,
  onRetry,
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

      {interest ? (
        <section className={`network-request-status ${
          failedTask ? 'network-request-status--error' : ''
        }`} aria-live="polite">
          <div className="network-request-status__icon" aria-hidden="true">
            {failedTask ? <AlertTriangle size={15} /> : <Send size={15} />}
          </div>
          {failedTask ? (
            <div>
              <strong>The current assignment did not finish</strong>
              <p>
                Your saved interest and unread messages are still on disk.
                Retry continues the same work instead of creating another
                request thread.
              </p>
              <small>
                {failedTask.error ?? 'The representative wake failed.'}
                {failedTask.nextRunAt
                  ? ` Next automatic retry ${dayjs(failedTask.nextRunAt).format('MMM D, HH:mm')}.`
                  : ''}
              </small>
            </div>
          ) : networkActivity?.request ? (
            <div>
              <strong>
                Asked your network {dayjs(networkActivity.request.createdAt)
                  .format('MMM D, HH:mm')}
              </strong>
              <p>{networkActivity.request.content}</p>
              <small>
                {describeNetworkResponses(networkActivity)}
              </small>
            </div>
          ) : (
            <div>
              <strong>Preparing a privacy-minimized network request</strong>
              <p>
                Your representative has the assignment. It is not considered
                delivered until you can see what was shared here.
              </p>
            </div>
          )}
        </section>
      ) : null}

      <footer className="check-controls">
        <div>
          <strong>
            {lastCheckedAt
              ? `Last agent wake ${dayjs(lastCheckedAt).format('MMM D, HH:mm')}`
              : 'Waiting for the first agent wake'}
          </strong>
          <p>
            {failedTask
              ? 'Retry repairs the current wake without adding another assignment or manual-check event.'
              : 'Saving changes queues a network request. Run now starts a fresh request thread without changing scheduled background checks.'}
          </p>
        </div>
        {failedTask ? (
          <Button
            disabled={!backgroundChecksEnabled || isRetrying || editing}
            onClick={onRetry}
          >
            <span className={isRetrying ? 'button-spinner' : ''}>
              <RefreshCw size={15} />
            </span>
            {isRetrying ? 'Retrying…' : 'Retry current work'}
          </Button>
        ) : (
          <Button
            disabled={
              !interest
              || !backgroundChecksEnabled
              || isChecking
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
        )}
      </footer>
    </section>
  );
}

function describeNetworkResponses(
  activity: NonNullable<DiscoverySnapshot['networkActivity']>,
): string {
  if (!activity.responseCount) {
    return 'Waiting for another representative to contribute something specific.';
  }
  const messageLabel = activity.responseCount === 1 ? 'message' : 'messages';
  const latest = activity.latestResponseAt
    ? ` · latest ${dayjs(activity.latestResponseAt).format('MMM D, HH:mm')}`
    : '';
  return [
    `${activity.responseCount} network ${messageLabel} received${latest}`,
    'your representative reviews them before reporting a finding',
  ].join(' · ');
}
