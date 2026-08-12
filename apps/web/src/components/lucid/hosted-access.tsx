import { FormEvent, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';

type HostedAccessProps = {
  storedTokenRejected: boolean;
  onUnlock: (token: string) => Promise<boolean>;
};

export function HostedAccess({
  storedTokenRejected,
  onUnlock,
}: HostedAccessProps) {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(
    storedTokenRejected ? 'The saved access token was not accepted.' : '',
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = token.trim();
    if (candidate.length < 32) {
      setError('Paste the full participant access token.');
      return;
    }

    setSubmitting(true);
    setError('');
    const accepted = await onUnlock(candidate).catch(() => false);
    setSubmitting(false);
    if (!accepted) {
      setError('Lucid did not accept that token. Check it and try again.');
    }
  };

  return (
    <main className="access-state">
      <section className="access-card" aria-labelledby="access-heading">
        <span className="access-card__icon" aria-hidden="true">
          <KeyRound size={20} />
        </span>
        <p className="section-label">Private pilot</p>
        <h1 id="access-heading">Open your Lucid workspace.</h1>
        <p>
          Enter the participant token configured for this demo. Lucid keeps it
          only in this browser tab and sends it directly to the same-origin API.
        </p>
        <form className="access-form" onSubmit={submit}>
          <label htmlFor="participant-access-token">Participant access token</label>
          <input
            aria-describedby={error ? 'participant-access-error' : undefined}
            aria-invalid={Boolean(error)}
            autoComplete="current-password"
            id="participant-access-token"
            minLength={32}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste access token"
            required
            spellCheck={false}
            type="password"
            value={token}
          />
          {error ? (
            <p
              className="access-form__error"
              id="participant-access-error"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <Button disabled={submitting} type="submit">
            {submitting ? 'Checking access…' : 'Open workspace'}
          </Button>
        </form>
        <p className="access-card__note">
          This is a bounded demo access gate, not Lucid’s future user identity
          system. Closing the tab clears the credential.
        </p>
      </section>
    </main>
  );
}
