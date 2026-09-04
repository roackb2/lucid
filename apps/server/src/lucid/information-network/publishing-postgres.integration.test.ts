import dayjs from 'dayjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { LOCAL_AGENT_ID, LOCAL_USER_ID } from '../local-user.js';
import {
  postgresNetworkProfiles as profiles,
} from '../persistence/postgres/schema.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../persistence/postgres/test-context.js';
import { LUCID_WORKSPACE_ID } from '../workspace/workspace-identity.js';
import {
  InformationNetworkPublishingService,
} from './publishing.js';
import {
  InformationNetworkPublicationClaimError,
  InformationNetworkPublicationConflictError,
} from './store.js';

const PROFILE_ID = 'publisher-profile';

describe('PostgreSQL Agent text publication', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];
  let publishing: InformationNetworkPublishingService;

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-agent-publication-test',
      reset: false,
    }));
    publishing = new InformationNetworkPublishingService(
      stores.informationNetwork,
    );
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: true });
    await database.orm.insert(profiles).values({
      id: PROFILE_ID,
      workspaceId: LUCID_WORKSPACE_ID,
      userId: LOCAL_USER_ID,
      publicDescription: 'A controlled source-backed publisher.',
      publishingFocus: 'Agent systems',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });
    await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Publish useful source-backed updates about Agent systems.',
    );
  });

  afterAll(async () => database.close());

  it('atomically publishes a Post and visible Sources for the owning claim', async () => {
    const claim = await beginWake('publication-execution-1');
    const receipt = await publishing.publishTextPost({
      userId: LOCAL_USER_ID,
      executionId: claim.claimToken,
      draft: sourceBackedDraft(),
    });

    expect(receipt).toMatchObject({
      outcome: 'published',
      postId: expect.stringMatching(/^post_/u),
      publishedAt: expect.any(String),
    });
    const persisted = await stores.informationNetwork.readPost(receipt.postId);
    expect(persisted).toEqual({
      author: expect.objectContaining({
        id: PROFILE_ID,
        displayName: 'You',
        representativeAgentName: 'Lucid',
      }),
      post: {
        id: receipt.postId,
        publicationMethod: 'agent',
        publishedAt: expect.any(String),
        ...sourceBackedDraft(),
        sources: [{
          id: expect.stringMatching(/^source_/u),
          retrievedAt: expect.any(String),
          ...sourceBackedDraft().sources[0],
        }],
      },
    });
    expect(dayjs(persisted?.post.publishedAt).toISOString())
      .toBe(receipt.publishedAt);
    expect(dayjs(persisted?.post.sources[0]?.retrievedAt).toISOString())
      .toBe(receipt.publishedAt);
  });

  it('returns the first commit after recovery instead of duplicating it', async () => {
    const firstClaim = await beginWake('publication-execution-original');
    const first = await publishing.publishTextPost({
      userId: LOCAL_USER_ID,
      executionId: firstClaim.claimToken,
      draft: sourceBackedDraft(),
    });
    const recoveredClaim = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'publication-execution-recovered',
      firstClaim.claimToken,
    );
    if (!recoveredClaim) {
      throw new Error('Expected publication wake recovery to transfer ownership.');
    }

    await expect(publishing.publishTextPost({
      userId: LOCAL_USER_ID,
      executionId: recoveredClaim.claimToken,
      draft: sourceBackedDraft(),
    })).resolves.toEqual({
      ...first,
      outcome: 'already-published',
    });
    await expect(stores.informationNetwork.readFeed(50))
      .resolves.toMatchObject({ postCount: 1 });
  });

  it('rejects different content under the same retry-stable wake identity', async () => {
    const claim = await beginWake('publication-execution-conflict');
    await publishing.publishTextPost({
      userId: LOCAL_USER_ID,
      executionId: claim.claimToken,
      draft: sourceBackedDraft(),
    });

    await expect(publishing.publishTextPost({
      userId: LOCAL_USER_ID,
      executionId: claim.claimToken,
      draft: {
        ...sourceBackedDraft(),
        body: 'A materially different second draft.',
      },
    })).rejects.toBeInstanceOf(InformationNetworkPublicationConflictError);
  });

  it('rejects publication after the durable wake claim is released', async () => {
    const claim = await beginWake('publication-execution-released');
    await stores.agent.interruptAgentWake(LOCAL_AGENT_ID, claim.claimToken);

    await expect(publishing.publishTextPost({
      userId: LOCAL_USER_ID,
      executionId: claim.claimToken,
      draft: sourceBackedDraft(),
    })).rejects.toBeInstanceOf(InformationNetworkPublicationClaimError);
  });

  async function beginWake(executionId: string) {
    const claim = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      executionId,
    );
    if (!claim) {
      throw new Error('Expected a source-backed publication wake claim.');
    }
    return claim;
  }
});

function sourceBackedDraft() {
  return {
    title: 'A durable publication boundary',
    body: 'Lucid owns the Post while Heddle owns reusable execution.',
    topics: ['Agent systems', 'Architecture'],
    sources: [{
      title: 'Execution Host architecture',
      sourceName: 'Heddle documentation',
      url: 'https://example.com/heddle/execution-host',
    }],
  };
}
