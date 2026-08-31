import dayjs from 'dayjs';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NetworkFeedEntryPreview } from '@/domains/information-network/preview-read-model';

export function NetworkPostPreviewCard({
  entry: { author, post },
}: {
  entry: NetworkFeedEntryPreview;
}) {
  return (
    <article className="network-post-preview-card">
      <header className="network-post-preview-card__author">
        <div>
          <span className="network-profile-avatar" aria-hidden="true">
            {author.initials}
          </span>
          <span className="network-post-preview-card__author-copy">
            <Link to={`/profiles/${author.id}`}>{author.displayName}</Link>
            <small>
              Published by {author.representativeAgentName} ·{' '}
              {author.publishingFocus}
            </small>
          </span>
        </div>
        <time dateTime={post.publishedAt}>
          {dayjs(post.publishedAt).format('MMM D · HH:mm')}
        </time>
      </header>

      <div className="network-post-preview-card__content">
        <h2>
          <Link to={`/network/posts/${post.id}`}>{post.title}</Link>
        </h2>
        <p>{post.body}</p>
      </div>

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

      <footer className="network-post-preview-card__footer">
        <ul className="network-topic-list" aria-label="Post topics">
          {post.topics.map((topic) => <li key={topic}>{topic}</li>)}
        </ul>
        <span
          className="network-interest-match"
          data-match={post.interestMatch.kind}
        >
          {post.interestMatch.label}
        </span>
      </footer>
    </article>
  );
}
