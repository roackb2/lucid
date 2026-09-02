import dayjs from 'dayjs';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { InformationNetworkFeed } from '@/lib/trpc';

export function NetworkPostCard({
  entry: { author, post },
}: {
  entry: InformationNetworkFeed['entries'][number];
}) {
  const publicationLabel = post.publicationMethod === 'seeded-pilot'
    ? 'Seeded pilot Post'
    : `Published by ${author.representativeAgentName}`;

  return (
    <article className="network-post-card">
      <header className="network-post-card__author">
        <div>
          <span className="network-profile-avatar" aria-hidden="true">
            {author.initials}
          </span>
          <span className="network-post-card__author-copy">
            <Link to={`/profiles/${author.id}`}>{author.displayName}</Link>
            <small>
              {publicationLabel} · {author.publishingFocus}
            </small>
          </span>
        </div>
        <time dateTime={post.publishedAt}>
          {dayjs(post.publishedAt).format('MMM D · HH:mm')}
        </time>
      </header>

      <div className="network-post-card__content">
        <h2 className="text-balance">
          <Link to={`/network/posts/${post.id}`}>{post.title}</Link>
        </h2>
        <p className="text-pretty">{post.body}</p>
      </div>

      {post.sources.length > 0 ? (
        <ul className="network-post-sources" aria-label="Post sources">
          {post.sources.map((source) => (
            <li key={source.id}>
              <a
                aria-label={`${source.sourceName}: ${source.title}`}
                href={source.url}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" />
                {source.sourceName}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="network-post-card__footer">
        <ul className="network-topic-list" aria-label="Post topics">
          {post.topics.map((topic) => <li key={topic}>{topic}</li>)}
        </ul>
      </footer>
    </article>
  );
}
