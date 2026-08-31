import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { previewInformationNetworkRepository } from '@/domains/information-network/preview-information-network-repository';
import { NetworkPostPreviewCard } from './network-post-preview-card';

describe('NetworkPostPreviewCard', () => {
  it('renders Profile, Post, Source, topic, and Interest-match navigation', () => {
    const [entry] = previewInformationNetworkRepository.readNetworkFeed().entries;
    if (!entry) {
      throw new Error('The deterministic Network preview requires a first Post.');
    }

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <NetworkPostPreviewCard entry={entry} />
      </MemoryRouter>,
    );

    expect(markup).toContain('href="/profiles/mina-chen"');
    expect(markup).toContain(
      'href="/network/posts/repairability-as-design-language"',
    );
    expect(markup).toContain('Vogue Taiwan');
    expect(markup).toContain('Sustainable design');
    expect(markup).toContain('Matches your network taste');
  });
});
