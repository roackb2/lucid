import { LogIn } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function GoogleSignIn({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <main className="access-state">
      <section className="access-card" aria-labelledby="google-sign-in-heading">
        <span className="access-card__icon" aria-hidden="true">
          <LogIn size={20} />
        </span>
        <p className="section-label">Private preview</p>
        <h1 id="google-sign-in-heading">Meet your Lucid agent.</h1>
        <p>
          Sign in with an invited Google account. Lucid gives each person a
          durable user identity and a agent in the shared agent
          network.
        </p>
        <Button
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            setError('');
            await onSignIn().catch((cause: unknown) => {
              setError(cause instanceof Error
                ? cause.message
                : 'Google sign-in could not start.');
              setSubmitting(false);
            });
          }}
        >
          {submitting ? 'Opening Google…' : 'Continue with Google'}
        </Button>
        {error ? <p className="access-form__error" role="alert">{error}</p> : null}
        <p className="access-card__note">
          Access is limited to the preview accounts configured by the operator.
        </p>
      </section>
    </main>
  );
}
