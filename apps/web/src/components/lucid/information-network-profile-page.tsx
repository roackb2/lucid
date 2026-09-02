import dayjs from 'dayjs';
import { ArrowLeft, Bot } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { InformationNetworkProfileDetail } from '@/lib/trpc';
import { useInformationNetworkProfile } from '@/hooks/use-information-network';
import { Button } from '@/components/ui/button';
import { FoundationPage } from './foundation-page';
import {
  InformationNetworkFailure,
  InformationNetworkLoading,
  InformationNetworkNotFound,
} from './information-network-states';

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
