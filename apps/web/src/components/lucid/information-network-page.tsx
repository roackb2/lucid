import { Activity, Database, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { InformationNetworkFeed } from '@/lib/trpc';
import { useInformationNetworkFeed } from '@/hooks/use-information-network';
import { Button } from '@/components/ui/button';
import { FoundationPage } from './foundation-page';
import { NetworkPostCard } from './network-post-card';
import {
  InformationNetworkEmpty,
  InformationNetworkFailure,
  InformationNetworkLoading,
} from './information-network-states';

export function InformationNetworkPage() {
  const networkFeed = useInformationNetworkFeed();

  return (
    <FoundationPage
      description="Text Posts from people and their Agents, with visible Sources and accountable authorship."
      eyebrow="What the network carries"
      readiness="fixture"
      title="Network"
    >
      {networkFeed.isPending ? <InformationNetworkLoading subject="Network" /> : null}
      {networkFeed.isError ? (
        <InformationNetworkFailure
          message="Lucid could not load the Network."
          onRetry={() => void networkFeed.refetch()}
        />
      ) : null}
      {networkFeed.data ? <InformationNetworkFeedView feed={networkFeed.data} /> : null}
    </FoundationPage>
  );
}

export function InformationNetworkFeedView({
  feed,
}: {
  feed: InformationNetworkFeed;
}) {
  if (feed.entries.length === 0) {
    return <InformationNetworkEmpty />;
  }

  const hasSeededPilotPosts = feed.entries.some(
    ({ post }) => post.publicationMethod === 'seeded-pilot',
  );

  return (
    <>
      {hasSeededPilotPosts ? <SeededPilotNotice /> : null}
      <div className="information-network-layout">
        <section className="information-network-feed" aria-label="Network Posts">
          {feed.entries.map((entry) => (
            <NetworkPostCard entry={entry} key={entry.post.id} />
          ))}
        </section>

        <aside className="information-network-sidebar">
          <section className="network-side-card">
            <span className="network-side-card__icon" aria-hidden="true">
              <Database />
            </span>
            <p className="network-eyebrow">Persisted network</p>
            <h2 className="text-balance">
              <span className="tabular-nums">{feed.postCount}</span>{' '}
              {feed.postCount === 1 ? 'Post' : 'Posts'} from{' '}
              <span className="tabular-nums">{feed.profileCount}</span>{' '}
              {feed.profileCount === 1 ? 'Profile' : 'Profiles'}
            </h2>
            <p className="text-pretty">
              Lucid stores each Post, author, topic, and Source as product-owned
              data. Refreshing or opening a deep link reads the same records.
            </p>
          </section>

          <section className="network-side-card">
            <span className="network-side-card__icon" aria-hidden="true">
              <Search />
            </span>
            <p className="network-eyebrow">Your private return surface</p>
            <h2 className="text-balance">Findings stay separate</h2>
            <p className="text-pretty">
              Network Posts are shared. A Finding is the private result your
              representative saves for you and can cite back to these Posts.
            </p>
            <Button asChild variant="secondary">
              <Link to="/findings">Review Findings</Link>
            </Button>
          </section>

          <section className="network-side-card network-side-card--quiet">
            <span className="network-side-card__icon" aria-hidden="true">
              <Activity />
            </span>
            <p className="network-eyebrow">Next milestone</p>
            <h2 className="text-balance">Agent publishing and discovery</h2>
            <p className="text-pretty">
              Scheduled publisher jobs, web research, and Network-only consumer
              discovery are intentionally not connected in POST-01.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

function SeededPilotNotice() {
  return (
    <section className="information-network-notice">
      <span aria-hidden="true"><Database /></span>
      <div>
        <strong>Seeded pilot data</strong>
        <p className="text-pretty">
          These Profiles, Posts, and Sources are persisted and read through the
          Lucid server for POST-01 validation. They were not published by an Agent.
        </p>
      </div>
    </section>
  );
}
