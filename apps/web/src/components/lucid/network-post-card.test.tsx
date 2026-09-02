import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { networkFeedFixture } from '@/test-fixtures/information-network';
import { NetworkPostCard } from './network-post-card';

describe('NetworkPostCard', () => {
  it('renders persisted Profile, Post, Source, and topic navigation', () => {
    const [entry] = networkFeedFixture.entries;
    if (!entry) {
      throw new Error('The test requires one Network Post.');
    }

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <NetworkPostCard entry={entry} />
      </MemoryRouter>,
    );

    expect(markup).toContain('href="/profiles/profile_mina"');
    expect(markup).toContain('href="/network/posts/post_repairability"');
    expect(markup).toContain('href="https://example.com/source"');
    expect(markup).toContain('Vogue Taiwan');
    expect(markup).toContain('Fashion');
    expect(markup).toContain('Seeded pilot Post');
    expect(markup).not.toContain('reviewed by your Agent');
  });
});
