import { Globe2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function InformationNetworkLoading({ subject }: { subject: string }) {
  return (
    <section
      aria-label={`Loading ${subject}`}
      className="information-network-loading"
      role="status"
    >
      <span />
      <span />
      <span />
      <p>Loading {subject}…</p>
    </section>
  );
}

export function InformationNetworkFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}) {
  return (
    <section className="information-network-state" role="alert">
      <Globe2 aria-hidden="true" />
      <h2 className="text-balance">Network unavailable</h2>
      <p className="text-pretty">{message} Your saved data remains unchanged.</p>
      <Button onClick={onRetry} variant="secondary">
        <RefreshCw aria-hidden="true" />
        Try again
      </Button>
    </section>
  );
}

export function InformationNetworkEmpty() {
  return (
    <section className="information-network-state">
      <Globe2 aria-hidden="true" />
      <h2 className="text-balance">No Posts yet</h2>
      <p className="text-pretty">
        Source-backed publications will appear here when Profiles begin
        contributing to the Information Network.
      </p>
      <Button asChild variant="secondary">
        <Link to="/interests">Review your Interest</Link>
      </Button>
    </section>
  );
}

export function InformationNetworkNotFound({
  objectName,
}: {
  objectName: 'Post' | 'Profile';
}) {
  return (
    <section className="information-network-state">
      <Globe2 aria-hidden="true" />
      <h2 className="text-balance">{objectName} not found</h2>
      <p className="text-pretty">
        This {objectName} does not exist in the Information Network.
      </p>
      <Button asChild variant="secondary">
        <Link to="/network">Return to Network</Link>
      </Button>
    </section>
  );
}
