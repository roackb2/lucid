import dayjs from 'dayjs';
import {
  CheckCircle2,
  Network,
  Route,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { FindingView } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type NetworkFindingsLibraryProps = {
  findings: FindingView[];
  hasInterest: boolean;
};

type FindingSource = FindingView['originatingSources'][number];

/**
 * Read-only learning surface for testing whether peer-derived findings and
 * their provenance are useful before Lucid commits to a Report domain.
 */
export function NetworkFindingsLibrary({
  findings,
  hasInterest,
}: NetworkFindingsLibraryProps) {
  const networkFindings = findings.filter(({ noMatch }) => !noMatch);
  const quietCheckCount = findings.length - networkFindings.length;
  const [selectedSequence, setSelectedSequence] = useState<number | undefined>(
    () => networkFindings[0]?.finding.sequence,
  );
  const selectedFinding = networkFindings.find(({ finding }) => (
    finding.sequence === selectedSequence
  )) ?? networkFindings[0];

  if (!selectedFinding) {
    return (
      <EmptyFindingsState
        hasInterest={hasInterest}
        quietCheckCount={quietCheckCount}
      />
    );
  }

  return (
    <section className="network-findings" aria-labelledby="network-findings-title">
      <div className="foundation-callout">
        <span className="foundation-callout__count tabular-nums">
          {networkFindings.length}
        </span>
        <div>
          <h2 className="network-findings__title" id="network-findings-title">
            {networkFindings.length === 1
              ? 'Network finding available'
              : 'Network findings available'}
          </h2>
          <p>
            Select a finding to inspect the peer-authored messages behind it.
          </p>
        </div>
      </div>

      <div className="foundation-layout foundation-layout--split network-findings__layout">
        <section
          className="network-findings__list"
          aria-labelledby="network-findings-list-title"
        >
          <header>
            <h3 id="network-findings-list-title">Received from the network</h3>
            {quietCheckCount > 0 ? (
              <span>
                {quietCheckCount} quiet {quietCheckCount === 1 ? 'check' : 'checks'} omitted
              </span>
            ) : null}
          </header>
          <ol>
            {networkFindings.map((finding) => {
              const sequence = finding.finding.sequence;
              const isSelected = sequence === selectedFinding.finding.sequence;

              return (
                <li key={finding.finding.id}>
                  <button
                    aria-controls={`network-finding-detail-${sequence}`}
                    aria-pressed={isSelected}
                    className={cn(
                      'network-findings__list-item',
                      isSelected && 'network-findings__list-item--selected',
                    )}
                    onClick={() => setSelectedSequence(sequence)}
                    type="button"
                  >
                    <span className="network-findings__list-meta">
                      <span>{describeOrigin(finding)}</span>
                      <time dateTime={finding.finding.createdAt}>
                        {dayjs(finding.finding.createdAt).format('MMM D')}
                      </time>
                    </span>
                    <strong>{finding.finding.content}</strong>
                    <span className="network-findings__list-evidence">
                      <Network aria-hidden="true" />
                      {describeEvidenceCount(finding.originatingSources.length)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <FindingEvidenceDetail finding={selectedFinding} />
      </div>
    </section>
  );
}

function EmptyFindingsState({
  hasInterest,
  quietCheckCount,
}: {
  hasInterest: boolean;
  quietCheckCount: number;
}) {
  return (
    <section
      className="foundation-panel network-findings-empty"
      aria-labelledby="network-findings-empty-title"
    >
      <header>
        <span className="foundation-panel__icon" aria-hidden="true">
          <Network />
        </span>
        <span className="foundation-status">Real network data only</span>
      </header>
      <div>
        <h2 id="network-findings-empty-title">No network-derived findings yet</h2>
        <p>
          When another participant contributes something your agent connects
          to your interest, the finding and its original messages will appear
          here. This learning slice does not fabricate examples.
        </p>
        {!hasInterest ? (
          <small>
            No interest is saved for the current local user. Lucid needs one
            before the agent can judge which network contributions relate.
          </small>
        ) : quietCheckCount > 0 ? (
          <small>
            {quietCheckCount} completed
            {' '}{quietCheckCount === 1 ? 'check is' : 'checks are'}
            {' '}intentionally kept out of the findings library.
          </small>
        ) : null}
      </div>
      <Button asChild className="network-findings-empty__action" variant="secondary">
        <Link to="/interests">
          {hasInterest ? 'Review the current interest' : 'Review Interests'}
        </Link>
      </Button>
    </section>
  );
}

function FindingEvidenceDetail({ finding }: { finding: FindingView }) {
  const sequence = finding.finding.sequence;
  const contributorCount = countContributors(finding.originatingSources);

  return (
    <article
      className="finding-card network-finding-detail"
      id={`network-finding-detail-${sequence}`}
      aria-labelledby={`network-finding-title-${sequence}`}
      aria-live="polite"
    >
      <header className="finding-card__header">
        <span className="finding-card__status" aria-hidden="true">
          <CheckCircle2 />
        </span>
        <div>
          <div className="finding-card__meta">
            <span>Selected finding</span>
            <time dateTime={finding.finding.createdAt}>
              {dayjs(finding.finding.createdAt).format('MMM D, YYYY · HH:mm')}
            </time>
          </div>
          <h3 id={`network-finding-title-${sequence}`}>
            {describeOrigin(finding)}
          </h3>
        </div>
      </header>

      <p className="finding-card__content">
        {finding.finding.content}
      </p>

      <div className="finding-card__chips">
        <span>
          <Network aria-hidden="true" />
          {contributorCount} original
          {' '}{contributorCount === 1
            ? 'contributor'
            : 'contributors'}
        </span>
        <span>
          {describeEvidenceCount(finding.originatingSources.length)}
        </span>
        <span>
          {finding.sources.length} cited
          {' '}{finding.sources.length === 1 ? 'message' : 'messages'}
        </span>
      </div>

      <section
        className="finding-explanation network-finding-evidence"
        aria-labelledby={`network-finding-evidence-title-${sequence}`}
      >
        <div className="finding-explanation__content">
          <section>
            <h4 id={`network-finding-evidence-title-${sequence}`}>
              <Route aria-hidden="true" />
              Original network contributions
            </h4>
            <p className="network-finding-evidence__intro">
              Relays are collapsed so one contribution is not presented as
              independent corroboration.
            </p>

            {finding.originatingSources.length > 0 ? (
              <ol>
                {finding.originatingSources.map((source) => (
                  <EvidenceMessage key={source.message.id} source={source} />
                ))}
              </ol>
            ) : (
              <p className="network-finding-evidence__missing">
                This experimental record does not expose an original
                peer-authored contribution. Lucid will not substitute a relay
                or delivery event and call it independent evidence.
              </p>
            )}
          </section>

          <p className="source-caveat">
            Provenance shows where the information came from. It does not mean
            the contribution is true, corroborated, or useful.
          </p>
        </div>
      </section>
    </article>
  );
}

function EvidenceMessage({ source }: { source: FindingSource }) {
  const displayName = source.attribution?.userDisplayName
    ?? source.attribution?.agentName
    ?? 'Network participant';
  const userKind = source.attribution?.userKind;

  return (
    <li>
      <span className="tabular-nums">#{source.message.sequence}</span>
      <div>
        <div className="source-message__identity">
          <strong>{displayName}</strong>
          {userKind ? (
            <span className={cn(
              'source-badge',
              userKind === 'human' && 'source-badge--real',
            )}>
              {userKind === 'human' ? 'Human user' : 'Synthetic user'}
            </span>
          ) : null}
          <time dateTime={source.message.createdAt}>
            {dayjs(source.message.createdAt).format('MMM D, HH:mm')}
          </time>
        </div>
        <p>{source.message.content}</p>
      </div>
    </li>
  );
}

function describeOrigin(finding: FindingView): string {
  return finding.origin === 'request-thread'
    ? 'Response to your request'
    : 'Found in the network';
}

function describeEvidenceCount(count: number): string {
  if (count === 0) {
    return 'No original message exposed';
  }
  return `${count} original ${count === 1 ? 'message' : 'messages'}`;
}

function countContributors(sources: FindingSource[]): number {
  return new Set(sources.map(({ attribution, message }) => (
    attribution?.userId ?? attribution?.agentId ?? message.id
  ))).size;
}
