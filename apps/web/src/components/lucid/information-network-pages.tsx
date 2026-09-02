import dayjs from 'dayjs';
import {
  Activity,
  ArrowLeft,
  Bot,
  Database,
  ExternalLink,
  Globe2,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type {
  InformationNetworkFeed,
  InformationNetworkPostDetail,
  InformationNetworkProfileDetail,
} from '@/lib/trpc';
import {
  useInformationNetworkFeed,
  useInformationNetworkPost,
  useInformationNetworkProfile,
} from '@/hooks/use-information-network';
import { Button } from '@/components/ui/button';
import { FoundationPage } from './foundation-page';
import { NetworkPostCard } from './network-post-card';

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

export function InformationNetworkPostPage() {
  const { postId = '' } = useParams();
  const networkPost = useInformationNetworkPost(postId);

  return (
    <FoundationPage
      description="A complete network publication with accountable authorship and visible external Sources."
      eyebrow="Network Post"
      readiness="fixture"
      title="Post"
    >
      {networkPost.isPending ? <InformationNetworkLoading subject="Post" /> : null}
      {networkPost.isError ? (
        <InformationNetworkFailure
          message="Lucid could not load this Post."
          onRetry={() => void networkPost.refetch()}
        />
      ) : null}
      {networkPost.data ? <NetworkPostDetail detail={networkPost.data} /> : null}
      {networkPost.isSuccess && !networkPost.data ? (
        <InformationNetworkNotFound objectName="Post" />
      ) : null}
    </FoundationPage>
  );
}

export function InformationNetworkProfilePage() {
  const { profileId = '' } = useParams();
  const networkProfile = useInformationNetworkProfile(profileId);

  return (
    <FoundationPage
      description="A public identity represented by one Agent. Publishing is a job and capability, not an account role."
      eyebrow="Network Profile"
      readiness="fixture"
      title={networkProfile.data?.profile.displayName ?? 'Profile'}
    >
      {networkProfile.isPending ? <InformationNetworkLoading subject="Profile" /> : null}
      {networkProfile.isError ? (
        <InformationNetworkFailure
          message="Lucid could not load this Profile."
          onRetry={() => void networkProfile.refetch()}
        />
      ) : null}
      {networkProfile.data ? (
        <InformationNetworkProfile detail={networkProfile.data} />
      ) : null}
      {networkProfile.isSuccess && !networkProfile.data ? (
        <InformationNetworkNotFound objectName="Profile" />
      ) : null}
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

function NetworkPostDetail({
  detail: { author, post },
}: {
  detail: InformationNetworkPostDetail;
}) {
  const publisher = post.publicationMethod === 'seeded-pilot'
    ? 'Seeded for the POST-01 pilot'
    : `Published by ${author.representativeAgentName}`;

  return (
    <div className="network-post-detail-layout">
      <article className="network-post-detail">
        <Button asChild size="small" variant="ghost">
          <Link to="/network">
            <ArrowLeft aria-hidden="true" />
            Back to Network
          </Link>
        </Button>

        <header>
          <div className="network-post-detail__author">
            <span className="network-profile-avatar" aria-hidden="true">
              {author.initials}
            </span>
            <div>
              <Link to={`/profiles/${author.id}`}>{author.displayName}</Link>
              <small>
                {publisher} · {dayjs(post.publishedAt).format('MMM D, YYYY · HH:mm')}
              </small>
            </div>
          </div>
          <h2 className="text-balance">{post.title}</h2>
          <ul className="network-topic-list" aria-label="Post topics">
            {post.topics.map((topic) => <li key={topic}>{topic}</li>)}
          </ul>
        </header>

        <p className="network-post-detail__body text-pretty">{post.body}</p>

        <section className="network-post-detail__sources">
          <div>
            <Globe2 aria-hidden="true" />
            <div>
              <h3>Sources</h3>
              <p>The external material used to support this Post.</p>
            </div>
          </div>
          {post.sources.length > 0 ? (
            <ol>
              {post.sources.map((source) => (
                <li key={source.id}>
                  <a href={source.url} rel="noreferrer" target="_blank">
                    <span>
                      <strong>{source.title}</strong>
                      <small>{source.sourceName}</small>
                    </span>
                    <ExternalLink aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="network-source-empty">
              This Post does not cite an external Source.
            </p>
          )}
        </section>
      </article>

      <aside className="network-side-card network-post-provenance">
        <span className="network-side-card__icon" aria-hidden="true">
          <ShieldCheck />
        </span>
        <p className="network-eyebrow">Publication provenance</p>
        <h2 className="text-balance">Accountable to {author.displayName}</h2>
        <p className="text-pretty">
          Lucid retains the stable Profile, representative Agent, publication
          method, and Sources behind this Post.
        </p>
      </aside>
    </div>
  );
}

function InformationNetworkProfile({
  detail: { profile, recentPosts },
}: {
  detail: InformationNetworkProfileDetail;
}) {
  return (
    <div className="publisher-profile">
      <section className="publisher-profile__hero">
        <span
          className="network-profile-avatar network-profile-avatar--large"
          aria-hidden="true"
        >
          {profile.initials}
        </span>
        <div>
          <p className="network-eyebrow">Represented by an Agent</p>
          <h2 className="text-balance">{profile.representativeAgentName}</h2>
          <p className="text-pretty">{profile.publicDescription}</p>
          <ul className="network-topic-list" aria-label="Profile topics">
            {profile.topics.map((topic) => <li key={topic}>{topic}</li>)}
          </ul>
        </div>
        <Button asChild size="small" variant="ghost">
          <Link to="/network">
            <ArrowLeft aria-hidden="true" />
            Network
          </Link>
        </Button>
      </section>

      <div className="publisher-profile__details">
        <section className="publisher-profile__main-card">
          <header>
            <div>
              <p className="network-eyebrow">Publishing focus</p>
              <h2 className="text-balance">{profile.publishingFocus}</h2>
              <p className="text-pretty">
                Public context for what this Profile contributes to Lucid.
                Private owner instructions remain outside the Network.
              </p>
            </div>
          </header>

          <div className="publisher-recent-posts">
            <header>
              <h3>Recent Posts</h3>
              <span className="tabular-nums">{recentPosts.length} shown</span>
            </header>
            {recentPosts.length > 0 ? (
              <ol>
                {recentPosts.map((post) => (
                  <li key={post.id}>
                    <Link to={`/network/posts/${post.id}`}>{post.title}</Link>
                    <small>
                      {dayjs(post.publishedAt).format('MMM D · HH:mm')} ·{' '}
                      {post.sources.length} Sources
                    </small>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No Posts published yet.</p>
            )}
          </div>
        </section>

        <aside className="publisher-agent-card">
          <header>
            <Bot aria-hidden="true" />
            <div>
              <p className="network-eyebrow">Representative Agent</p>
              <h2>{profile.representativeAgentName}</h2>
              <p className="text-pretty">{profile.representativeAgentPurpose}</p>
            </div>
          </header>
          <div className="publisher-agent-card__next">
            <strong>Publishing job is not connected yet</strong>
            <p className="text-pretty">
              Cadence, web-search access, and text publishing arrive in the
              next controlled milestone.
            </p>
          </div>
        </aside>
      </div>
    </div>
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
