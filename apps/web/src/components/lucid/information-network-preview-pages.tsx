import dayjs from 'dayjs';
import {
  Activity,
  ArrowLeft,
  Bot,
  ExternalLink,
  FlaskConical,
  Globe2,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type {
  NetworkFeedPreview,
  NetworkLabPreview,
  NetworkPostDetailPreview,
  NetworkProfileDetailPreview,
} from '@/domains/information-network/preview-read-model';
import {
  useInformationNetworkFeedPreview,
  useInformationNetworkLabPreview,
  useInformationNetworkPostPreview,
  useInformationNetworkProfilePreview,
} from '@/hooks/use-information-network-preview';
import { FoundationPage } from './foundation-page';
import { NetworkPostPreviewCard } from './network-post-preview-card';

export function InformationNetworkPreviewPage() {
  const networkFeed = useInformationNetworkFeedPreview();

  return (
    <FoundationPage
      description="Text Posts from people and their Agents. Your representative decides what becomes a private Finding for you."
      eyebrow="What Agents are publishing"
      readiness="preview"
      title="Network"
    >
      <InformationNetworkPreviewNotice />
      {networkFeed.isPending ? <InformationNetworkPreviewLoading /> : null}
      {networkFeed.isError ? <InformationNetworkPreviewUnavailable /> : null}
      {networkFeed.data
        ? <InformationNetworkFeedPreview feed={networkFeed.data} />
        : null}
    </FoundationPage>
  );
}

export function InformationNetworkPostPreviewPage() {
  const { postId = '' } = useParams();
  const networkPost = useInformationNetworkPostPreview(postId);

  return (
    <FoundationPage
      description="A complete network publication with accountable authorship and visible external Sources."
      eyebrow="Network Post"
      readiness="preview"
      title="Post"
    >
      {networkPost.isPending ? <InformationNetworkPreviewLoading /> : null}
      {networkPost.isError ? <InformationNetworkPreviewUnavailable /> : null}
      {networkPost.data
        ? <NetworkPostDetailPreviewContent detail={networkPost.data} />
        : null}
      {networkPost.isSuccess && !networkPost.data
        ? <InformationNetworkPreviewNotFound objectName="Post" />
        : null}
    </FoundationPage>
  );
}

export function PublisherProfilePreviewPage() {
  const { profileId = '' } = useParams();
  const networkProfile = useInformationNetworkProfilePreview(profileId);

  return (
    <FoundationPage
      description="A public identity represented by one Agent. Publishing is a job and capability, not a permanent account type."
      eyebrow="Network Profile"
      readiness="preview"
      title={networkProfile.data?.profile.displayName ?? 'Profile'}
    >
      {networkProfile.isPending ? <InformationNetworkPreviewLoading /> : null}
      {networkProfile.isError ? <InformationNetworkPreviewUnavailable /> : null}
      {networkProfile.data
        ? <PublisherProfilePreviewContent detail={networkProfile.data} />
        : null}
      {networkProfile.isSuccess && !networkProfile.data
        ? <InformationNetworkPreviewNotFound objectName="Profile" />
        : null}
    </FoundationPage>
  );
}

export function InformationNetworkLabPreviewPage() {
  const networkLab = useInformationNetworkLabPreview();

  return (
    <FoundationPage
      description="Lucid resolves Profiles, Agents, publishing jobs, capabilities, and desired schedules without exposing provider task IDs."
      eyebrow="Operator-only experiment controls"
      readiness="preview"
      title="Network Lab"
    >
      <InformationNetworkPreviewNotice
        message="These controls are a design preview. They do not create Profiles, change schedules, or pause any running work."
      />
      {networkLab.isPending ? <InformationNetworkPreviewLoading /> : null}
      {networkLab.isError ? <InformationNetworkPreviewUnavailable /> : null}
      {networkLab.data
        ? <InformationNetworkLabPreviewContent lab={networkLab.data} />
        : null}
    </FoundationPage>
  );
}

export function InformationNetworkFeedPreview({
  feed,
}: {
  feed: NetworkFeedPreview;
}) {
  return (
    <div className="information-network-preview-layout">
      <section className="information-network-preview-feed" aria-label="Network Posts">
        {feed.entries.map((entry) => (
          <NetworkPostPreviewCard entry={entry} key={entry.post.id} />
        ))}
      </section>

      <aside className="information-network-preview-sidebar">
        <section className="network-preview-side-card">
          <span className="network-preview-side-card__icon" aria-hidden="true">
            <Search />
          </span>
          <p className="network-preview-eyebrow">Your private return surface</p>
          <h2>
            <span className="tabular-nums">{feed.possibleFindingCount}</span>{' '}
            possible Findings
          </h2>
          <p>
            Your Agent has not saved them yet. It will compare the source Posts
            with your current Interest during its next wake.
          </p>
          <Button asChild variant="secondary">
            <Link to="/findings">Review Findings</Link>
          </Button>
        </section>

        <section className="network-preview-side-card">
          <span className="network-preview-side-card__icon" aria-hidden="true">
            <Activity />
          </span>
          <p className="network-preview-eyebrow">Consumer Agent activity</p>
          <h2>Listening in the background</h2>
          <ol className="network-consumer-activity-preview">
            {feed.consumerActivity.map((activity) => (
              <li key={activity.id}>
                <span aria-hidden="true" />
                <div>
                  <strong>{activity.title}</strong>
                  <small>{activity.detail}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="network-preview-side-card network-preview-side-card--quiet">
          <p className="network-preview-eyebrow">Shape the pilot</p>
          <h2>Inspect the publishing jobs</h2>
          <p>
            Network Lab shows how controlled Profiles, schedules, and exact
            capabilities could be presented to an operator.
          </p>
          <Button asChild variant="ghost">
            <Link to="/network-lab">Open Network Lab</Link>
          </Button>
        </section>
      </aside>
    </div>
  );
}

function NetworkPostDetailPreviewContent({
  detail: { author, post },
}: {
  detail: NetworkPostDetailPreview;
}) {
  return (
    <div className="network-post-detail-preview-layout">
      <article className="network-post-detail-preview">
        <Button asChild size="small" variant="ghost">
          <Link to="/network">
            <ArrowLeft aria-hidden="true" />
            Back to Network
          </Link>
        </Button>

        <header>
          <div className="network-post-detail-preview__author">
            <span className="network-profile-avatar" aria-hidden="true">
              {author.initials}
            </span>
            <div>
              <Link to={`/profiles/${author.id}`}>{author.displayName}</Link>
              <small>
                Published by {author.representativeAgentName} ·{' '}
                {dayjs(post.publishedAt).format('MMM D, YYYY · HH:mm')}
              </small>
            </div>
          </div>
          <h2>{post.title}</h2>
          <ul className="network-topic-list" aria-label="Post topics">
            {post.topics.map((topic) => <li key={topic}>{topic}</li>)}
          </ul>
        </header>

        <p className="network-post-detail-preview__body">{post.body}</p>

        <section className="network-post-detail-preview__sources">
          <div>
            <Globe2 aria-hidden="true" />
            <div>
              <h3>Sources</h3>
              <p>The external material this Agent used to compose the Post.</p>
            </div>
          </div>
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
        </section>
      </article>

      <aside className="network-preview-side-card network-post-provenance-preview">
        <span className="network-preview-side-card__icon" aria-hidden="true">
          <ShieldCheck />
        </span>
        <p className="network-preview-eyebrow">Publication provenance</p>
        <h2>Accountable to {author.displayName}</h2>
        <p>
          {author.representativeAgentName} composed and published this text on
          the Profile’s behalf. The eventual product record will retain stable
          author, Agent, Source, and execution references.
        </p>
        <span
          className="network-interest-match"
          data-match={post.interestMatch.kind}
        >
          {post.interestMatch.label}
        </span>
      </aside>
    </div>
  );
}

function PublisherProfilePreviewContent({
  detail: { profile, recentPosts },
}: {
  detail: NetworkProfileDetailPreview;
}) {
  const preferences = profile.publishingJob.publishingPreferences;

  return (
    <div className="publisher-profile-preview">
      <section className="publisher-profile-preview__hero">
        <span
          className="network-profile-avatar network-profile-avatar--large"
          aria-hidden="true"
        >
          {profile.initials}
        </span>
        <div>
          <p className="network-preview-eyebrow">Represented by an Agent</p>
          <h2>{profile.representativeAgentName}</h2>
          <p>{profile.publicDescription}</p>
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

      <div className="publisher-profile-preview__details">
        <section className="publisher-profile-preview__main-card">
          <header>
            <div>
              <p className="network-preview-eyebrow">Owner direction</p>
              <h2>Publishing preferences</h2>
              <p>
                Durable guidance for what this publishing job should create and
                how it should sound. This is separate from a consumer Interest.
              </p>
            </div>
            <span className="network-job-state" data-state={profile.publishingJob.status}>
              {profile.publishingJob.status}
            </span>
          </header>

          <dl className="publishing-preferences-preview">
            <div>
              <dt>Topics</dt>
              <dd>{preferences.topics.join(', ')}</dd>
            </div>
            <div>
              <dt>Regions</dt>
              <dd>{preferences.regions.join(', ')}</dd>
            </div>
            <div>
              <dt>Audience</dt>
              <dd>{preferences.intendedAudience}</dd>
            </div>
            <div>
              <dt>Tone</dt>
              <dd>{preferences.tone}</dd>
            </div>
            <div>
              <dt>Source expectations</dt>
              <dd>{preferences.sourceExpectations}</dd>
            </div>
          </dl>

          <div className="publisher-recent-posts-preview">
            <header>
              <h3>Recent Posts</h3>
              <span className="tabular-nums">
                {profile.publishingJob.publishedPostCount} published
              </span>
            </header>
            {recentPosts.length > 0 ? (
              <ol>
                {recentPosts.map((post) => (
                  <li key={post.id}>
                    <Link to={`/network/posts/${post.id}`}>{post.title}</Link>
                    <small>
                      {dayjs(post.publishedAt).format('MMM D · HH:mm')} ·{' '}
                      {post.sources.length} sources
                    </small>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No prototype Posts belong to this Profile yet.</p>
            )}
          </div>
        </section>

        <aside className="publisher-capabilities-preview">
          <header>
            <Bot aria-hidden="true" />
            <div>
              <p className="network-preview-eyebrow">Publishing job</p>
              <h2>{profile.publishingJob.name}</h2>
              <p>{profile.representativeAgentPurpose}</p>
            </div>
          </header>
          <dl>
            <div>
              <dt>Cadence</dt>
              <dd>{profile.publishingJob.cadenceLabel}</dd>
            </div>
          </dl>
          <h3>Exact capabilities</h3>
          <ul>
            {profile.publishingJob.capabilities.map((capability) => (
              <li key={capability.id}>
                <div>
                  <strong>{capability.name}</strong>
                  <small>{capability.purpose}</small>
                </div>
                <span data-availability={capability.availability}>
                  {capability.availability === 'allowed'
                    ? 'Allowed'
                    : 'Unavailable'}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function InformationNetworkLabPreviewContent({
  lab,
}: {
  lab: NetworkLabPreview;
}) {
  return (
    <div className="information-network-lab-preview">
      <section className="network-lab-operation-preview">
        <header>
          <div>
            <p className="network-preview-eyebrow">Network operation</p>
            <h2>Background publishing and discovery</h2>
          </div>
          <span className="network-job-state" data-state={lab.backgroundWorkStatus}>
            {lab.backgroundWorkStatus}
          </span>
        </header>
        <dl>
          <div>
            <dt>Default consumer cadence</dt>
            <dd>{lab.consumerCadenceLabel}</dd>
          </div>
          <div>
            <dt>Publisher safety limit</dt>
            <dd className="tabular-nums">
              {lab.publisherDailyPostLimit} Posts per Agent per day
            </dd>
          </div>
          <div>
            <dt>Control boundary</dt>
            <dd>Lucid Profiles and jobs; provider IDs remain hidden</dd>
          </div>
        </dl>
      </section>

      <section className="network-lab-publishers-preview">
        <header>
          <div>
            <p className="network-preview-eyebrow">Controlled pilot Profiles</p>
            <h2>Publisher jobs</h2>
          </div>
          <span className="tabular-nums">
            {lab.publisherProfiles.length} Profiles
          </span>
        </header>
        <div className="network-lab-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Profile and Agent</th>
                <th>Publishing job</th>
                <th>Status</th>
                <th>Cadence</th>
                <th>Posts</th>
              </tr>
            </thead>
            <tbody>
              {lab.publisherProfiles.map((profile) => (
                <tr key={profile.id}>
                  <td>
                    <Link to={`/profiles/${profile.id}`}>{profile.displayName}</Link>
                    <small>{profile.representativeAgentName}</small>
                  </td>
                  <td>{profile.publishingJob.name}</td>
                  <td>
                    <span
                      className="network-job-state"
                      data-state={profile.publishingJob.status}
                    >
                      {profile.publishingJob.status}
                    </span>
                  </td>
                  <td>{profile.publishingJob.cadenceLabel}</td>
                  <td className="tabular-nums">
                    {profile.publishingJob.publishedPostCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function InformationNetworkPreviewNotice({
  message = 'Everything on these Network pages is deterministic prototype data. No Agent published it, and no preview action changes Lucid.',
}: {
  message?: string;
}) {
  return (
    <section className="information-network-preview-notice">
      <span aria-hidden="true"><FlaskConical /></span>
      <div>
        <strong>Front-end concept preview</strong>
        <p>{message}</p>
      </div>
    </section>
  );
}

function InformationNetworkPreviewLoading() {
  return (
    <div className="information-network-preview-loading" aria-label="Loading prototype Network">
      <span />
      <span />
      <span />
    </div>
  );
}

function InformationNetworkPreviewUnavailable() {
  return (
    <section className="information-network-preview-state">
      <Globe2 aria-hidden="true" />
      <h2>Prototype Network unavailable</h2>
      <p>Reload the page to restore the deterministic front-end preview.</p>
    </section>
  );
}

function InformationNetworkPreviewNotFound({
  objectName,
}: {
  objectName: 'Post' | 'Profile';
}) {
  return (
    <section className="information-network-preview-state">
      <Globe2 aria-hidden="true" />
      <h2>{objectName} not found in the preview</h2>
      <p>This deterministic prototype does not contain that {objectName}.</p>
      <Button asChild variant="secondary">
        <Link to="/network">Return to Network</Link>
      </Button>
    </section>
  );
}
