import { useState, type FormEvent } from 'react';
import { UserRoundPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type ParticipantOnboardingInput = {
  displayName: string;
  privateContext: string;
  contextApproved: true;
};

export function ParticipantOnboarding({
  enrollmentAllowed,
  onEnroll,
  onSignOut,
}: {
  enrollmentAllowed: boolean;
  onEnroll: (input: ParticipantOnboardingInput) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState('');
  const [privateContext, setPrivateContext] = useState('');
  const [approved, setApproved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!approved) {
      setError('Confirm that Lucid may use this context for your representative.');
      return;
    }
    setSubmitting(true);
    setError('');
    await onEnroll({
      displayName: displayName.trim(),
      privateContext: privateContext.trim(),
      contextApproved: true,
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Enrollment failed.');
      setSubmitting(false);
    });
  };

  return (
    <main className="access-state">
      <section className="access-card" aria-labelledby="participant-onboarding-heading">
        <span className="access-card__icon" aria-hidden="true">
          <UserRoundPlus size={20} />
        </span>
        <p className="section-label">Your representative</p>
        <h1 id="participant-onboarding-heading">Choose what Lucid should represent.</h1>
        {enrollmentAllowed ? (
          <form className="access-form" onSubmit={submit}>
            <label htmlFor="participant-display-name">Display name</label>
            <input
              id="participant-display-name"
              maxLength={80}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              value={displayName}
            />
            <label htmlFor="participant-private-context">
              Private context for your representative
            </label>
            <textarea
              id="participant-private-context"
              maxLength={4_000}
              onChange={(event) => setPrivateContext(event.target.value)}
              placeholder="What should your representative look for, understand, or protect?"
              required
              rows={6}
              value={privateContext}
            />
            <label>
              <input
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
                type="checkbox"
              />
              Lucid may use this private context when operating my representative.
            </label>
            {error ? <p className="access-form__error" role="alert">{error}</p> : null}
            <Button disabled={submitting} type="submit">
              {submitting ? 'Creating representative…' : 'Create my representative'}
            </Button>
          </form>
        ) : (
          <p>
            This Google account is authenticated, but it has not been invited
            into this Lucid preview.
          </p>
        )}
        <Button onClick={() => void onSignOut()} variant="secondary">
          Sign out
        </Button>
      </section>
    </main>
  );
}
