import { describe, expect, it, vi } from 'vitest';
import {
  InformationNetworkPublishingInputError,
  InformationNetworkPublishingService,
} from './publishing.js';

describe('InformationNetworkPublishingService', () => {
  it('normalizes a source-backed draft before delegating the trusted claim', async () => {
    const publishAgentTextPost = vi.fn(async () => ({
      outcome: 'published' as const,
      postId: 'post-1',
      publishedAt: '2026-09-04T00:00:00.000Z',
    }));
    const service = new InformationNetworkPublishingService({
      publishAgentTextPost,
    });

    await expect(service.publishTextPost({
      userId: 'user-1',
      executionId: 'execution-1',
      draft: {
        title: '  A useful update  ',
        body: '  A concise source-backed explanation.  ',
        topics: ['  Architecture ', 'Agent systems'],
        sources: [{
          title: '  Original report ',
          sourceName: '  Example News ',
          url: 'https://EXAMPLE.com:443/report',
        }],
      },
    })).resolves.toMatchObject({ outcome: 'published', postId: 'post-1' });
    expect(publishAgentTextPost).toHaveBeenCalledWith({
      userId: 'user-1',
      executionId: 'execution-1',
    }, {
      title: 'A useful update',
      body: 'A concise source-backed explanation.',
      topics: ['Architecture', 'Agent systems'],
      sources: [{
        title: 'Original report',
        sourceName: 'Example News',
        url: 'https://example.com/report',
      }],
    });
  });

  it.each([
    {
      name: 'has no source',
      draft: validDraft({ sources: [] }),
    },
    {
      name: 'uses a non-web source URL',
      draft: validDraft({
        sources: [{
          title: 'Private file',
          sourceName: 'Local machine',
          url: 'file:///tmp/report.txt',
        }],
      }),
    },
    {
      name: 'repeats a topic with different casing',
      draft: validDraft({ topics: ['Architecture', 'architecture'] }),
    },
    {
      name: 'repeats a canonical source URL',
      draft: validDraft({
        sources: [
          {
            title: 'First',
            sourceName: 'Example',
            url: 'https://example.com/report',
          },
          {
            title: 'Second',
            sourceName: 'Example',
            url: 'https://EXAMPLE.com:443/report',
          },
        ],
      }),
    },
  ])('rejects a draft that $name', async ({ draft }) => {
    const publishAgentTextPost = vi.fn();
    const service = new InformationNetworkPublishingService({
      publishAgentTextPost,
    });

    await expect(service.publishTextPost({
      userId: 'user-1',
      executionId: 'execution-1',
      draft,
    })).rejects.toBeInstanceOf(InformationNetworkPublishingInputError);
    expect(publishAgentTextPost).not.toHaveBeenCalled();
  });
});

function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    title: 'A useful update',
    body: 'A concise source-backed explanation.',
    topics: ['Architecture'],
    sources: [{
      title: 'Original report',
      sourceName: 'Example News',
      url: 'https://example.com/report',
    }],
    ...overrides,
  };
}
