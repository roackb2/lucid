import dayjs from 'dayjs';
import { ArrowLeft, ExternalLink, Globe2, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { InformationNetworkPostDetail } from '@/lib/trpc';
import { useInformationNetworkPost } from '@/hooks/use-information-network';
import { Button } from '@/components/ui/button';
import { FoundationPage } from './foundation-page';
import {
  InformationNetworkFailure,
  InformationNetworkLoading,
  InformationNetworkNotFound,
} from './information-network-states';

export function InformationNetworkPostPage() {
  const { postId = '' } = useParams();
  const networkPost = useInformationNetworkPost(postId);

  return (
    <FoundationPage
      description="A complete network publication with accountable authorship and visible external Sources."
      eyebrow="Network Post"
      readiness={networkPost.data?.post.publicationMethod === 'agent'
        ? 'working'
        : 'fixture'}
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
