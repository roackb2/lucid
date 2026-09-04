import type { McpInvocationScope } from '@heddleagent/execution-host-client/mcp';
import { describe, expect, it, vi } from 'vitest';
import {
  CapabilityScopedInformationNetworkPublisher,
  InformationNetworkPublisherScopeError,
} from './information-network-publisher.js';

describe('CapabilityScopedInformationNetworkPublisher', () => {
  it('derives product identity from the verified heartbeat scope', async () => {
    const publishTextPost = vi.fn(async () => ({
      outcome: 'published' as const,
      postId: 'post-1',
      publishedAt: '2026-09-04T00:00:00.000Z',
    }));
    const publisher = new CapabilityScopedInformationNetworkPublisher({
      tenantId: 'tenant-a',
      productSessionId: 'session-a',
    }, { publishTextPost });

    await publisher.publishTextPost({
      scope: invocationScope(),
      draft: draft(),
      signal: new AbortController().signal,
    });

    expect(publishTextPost).toHaveBeenCalledWith({
      userId: 'user-a',
      executionId: 'execution-a',
      draft: draft(),
    });
  });

  it.each([
    { tenantId: 'another-tenant' },
    { productSessionId: 'another-session' },
    { workflow: 'conversation-turn' as const },
  ])('rejects mismatched scope $tenantId$productSessionId$workflow', async (
    override,
  ) => {
    const publishTextPost = vi.fn();
    const publisher = new CapabilityScopedInformationNetworkPublisher({
      tenantId: 'tenant-a',
      productSessionId: 'session-a',
    }, { publishTextPost });

    await expect(publisher.publishTextPost({
      scope: invocationScope(override),
      draft: draft(),
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(InformationNetworkPublisherScopeError);
    expect(publishTextPost).not.toHaveBeenCalled();
  });
});

function invocationScope(
  override: Partial<McpInvocationScope> = {},
): McpInvocationScope {
  return {
    adopterId: 'lucid',
    tenantId: 'tenant-a',
    subjectId: 'user-a',
    productSessionId: 'session-a',
    runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
    invocationId: 'execution-a',
    workflow: 'heartbeat-task',
    ...override,
  };
}

function draft() {
  return {
    title: 'A useful update',
    body: 'A source-backed explanation.',
    topics: ['Agent systems'],
    sources: [{
      title: 'Original report',
      sourceName: 'Example News',
      url: 'https://example.com/report',
    }],
  };
}
