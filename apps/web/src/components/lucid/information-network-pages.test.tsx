import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { networkFeedFixture } from '@/test-fixtures/information-network';
import {
  InformationNetworkEmpty,
  InformationNetworkFailure,
  InformationNetworkFeedView,
  InformationNetworkLoading,
  InformationNetworkNotFound,
} from './information-network-pages';

const render = (component: ReactNode) => renderToStaticMarkup(
  <MemoryRouter>{component}</MemoryRouter>,
);

describe('Information Network page states', () => {
  it('renders persisted counts and labels seeded records truthfully', () => {
    const markup = render(<InformationNetworkFeedView feed={networkFeedFixture} />);

    expect(markup).toContain('Post from');
    expect(markup).toContain('Profile');
    expect(markup).toContain('Seeded pilot data');
    expect(markup).toContain('were not published by an Agent');
    expect(markup).not.toContain('possible Findings');
  });

  it('provides honest loading, error, empty, and not-found states', () => {
    const retry = vi.fn();
    const loading = render(<InformationNetworkLoading subject="Network" />);
    const failure = render(
      <InformationNetworkFailure message="Read failed." onRetry={retry} />,
    );
    const empty = render(<InformationNetworkEmpty />);
    const missing = render(<InformationNetworkNotFound objectName="Post" />);

    expect(loading).toContain('Loading Network');
    expect(loading).toContain('role="status"');
    expect(failure).toContain('Try again');
    expect(failure).toContain('Read failed.');
    expect(empty).toContain('No Posts yet');
    expect(empty).toContain('href="/interests"');
    expect(missing).toContain('Post not found');
    expect(missing).toContain('href="/network"');
  });
});
