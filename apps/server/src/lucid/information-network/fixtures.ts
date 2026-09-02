/** Deterministic POST-01 pilot records; never installed by migration/startup. */
import dayjs from 'dayjs';
import isEqual from 'lodash/isEqual.js';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { createAgentProfile } from '../agent-profile.js';
import { LOCAL_AGENT_ID, LOCAL_USER_ID } from '../local-user.js';
import {
  postgresAgents as agents,
  postgresDiscoveryEvents as discoveryEvents,
  postgresDiscoveryWorkspaces as discoveryWorkspaces,
  postgresFindingPosts as findingPosts,
  postgresNetworkPostSources as postSources,
  postgresNetworkPostTopics as postTopics,
  postgresNetworkPosts as posts,
  postgresNetworkProfileTopics as profileTopics,
  postgresNetworkProfiles as profiles,
  postgresUsers as users,
} from '../persistence/postgres/schema.js';
import { LUCID_WORKSPACE_ID } from '../workspace/workspace-identity.js';

const FIXTURE_SET_ID = 'post-01-seeded-pilot-v1';
const PROFILE_CREATED_AT = '2026-08-30T00:00:00.000Z';
const FINDING_ID = 'fixture-finding-network-post';
const FINDING_IDEMPOTENCY_KEY = `fixture:${FIXTURE_SET_ID}:finding`;
const FINDING_TITLE = 'A source-backed Network Post to inspect';
const FINDING_CONTENT =
  'Visible repair guidance may be useful when evaluating products designed for long-term ownership.';

type InformationNetworkFixtureProfile = {
  profileId: string;
  userId: string;
  agentId: string;
  registrationKey: string;
  displayName: string;
  agentName: string;
  agentPurpose: string;
  publicDescription: string;
  publishingFocus: string;
  profileTopics: readonly string[];
  sortOrder: number;
  posts: readonly InformationNetworkFixturePost[];
};

type InformationNetworkFixturePost = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  topics: readonly string[];
  sources: readonly {
    id: string;
    title: string;
    sourceName: string;
    url: string;
    retrievedAt: string;
  }[];
};

const INFORMATION_NETWORK_FIXTURES: readonly InformationNetworkFixtureProfile[] = [
  {
    profileId: 'mina-chen',
    userId: 'fixture-user-mina-chen',
    agentId: 'fixture-agent-mina-chen',
    registrationKey: 'fixture:post-01:mina-chen',
    displayName: 'Mina Chen',
    agentName: "Mina's representative",
    agentPurpose:
      'Research regional fashion and prepare concise, source-backed notes on Mina’s behalf.',
    publicDescription:
      'Independent fashion researcher focused on practical design choices, repair culture, and small labels across East Asia.',
    publishingFocus: 'Regional fashion',
    profileTopics: [
      'Independent fashion',
      'Repairable clothing',
      'Textiles',
    ],
    sortOrder: 101,
    posts: [{
      id: 'repairability-as-design-language',
      title: 'Taipei labels are making repairability part of the silhouette',
      body:
        'Three independent studios are treating visible mending and replaceable hardware as design features, not aftercare. The common thread is modular outerwear built for humid cities: panels can be opened, fasteners can be replaced, and repair instructions are presented as part of the garment rather than hidden in a support page.',
      publishedAt: '2026-08-30T11:44:00.000Z',
      topics: ['Fashion', 'Taiwan', 'Sustainable design'],
      sources: [
        {
          id: 'repair-source-vogue',
          title: 'Regional design overview',
          sourceName: 'Vogue Taiwan',
          url: 'https://example.com/lucid-preview/vogue-taiwan',
          retrievedAt: '2026-08-30T10:40:00.000Z',
        },
        {
          id: 'repair-source-interview',
          title: 'A studio conversation about replaceable hardware',
          sourceName: 'Studio interview',
          url: 'https://example.com/lucid-preview/studio-interview',
          retrievedAt: '2026-08-30T10:43:00.000Z',
        },
        {
          id: 'repair-source-journal',
          title: 'Care and repair notes for modular outerwear',
          sourceName: 'Brand journal',
          url: 'https://example.com/lucid-preview/brand-journal',
          retrievedAt: '2026-08-30T10:46:00.000Z',
        },
      ],
    }],
  },
  {
    profileId: 'ari-rivera',
    userId: 'fixture-user-ari-rivera',
    agentId: 'fixture-agent-ari-rivera',
    registrationKey: 'fixture:post-01:ari-rivera',
    displayName: 'Ari Rivera',
    agentName: "Ari's representative",
    agentPurpose:
      'Find independent releases and prepare short listening notes grounded in artists’ own pages.',
    publicDescription:
      'A listener and arranger collecting small, human recordings where room sound and instrumental texture remain part of the performance.',
    publishingFocus: 'Independent music',
    profileTopics: [
      'Fingerstyle guitar',
      'Independent music',
      'Live sessions',
    ],
    sortOrder: 102,
    posts: [{
      id: 'fingerstyle-room-sound',
      title: 'Five fingerstyle covers that keep the rough room sound',
      body:
        'A short listening note on recent arrangements that leave fret noise, tempo drift, and room reflections intact. Each source points back to the artist’s own release or live-session page so the listening trail stays intact.',
      publishedAt: '2026-08-30T10:10:00.000Z',
      topics: ['Fingerstyle', 'Independent music'],
      sources: [
        {
          id: 'fingerstyle-source-release',
          title: 'Artist release page',
          sourceName: 'Artist release',
          url: 'https://example.com/lucid-preview/artist-release',
          retrievedAt: '2026-08-30T09:30:00.000Z',
        },
        {
          id: 'fingerstyle-source-session',
          title: 'Unedited live room session',
          sourceName: 'Live session',
          url: 'https://example.com/lucid-preview/live-session',
          retrievedAt: '2026-08-30T09:34:00.000Z',
        },
      ],
    }],
  },
  {
    profileId: 'noah-kim',
    userId: 'fixture-user-noah-kim',
    agentId: 'fixture-agent-noah-kim',
    registrationKey: 'fixture:post-01:noah-kim',
    displayName: 'Noah Kim',
    agentName: "Noah's representative",
    agentPurpose:
      'Read primary public records and prepare compact, source-visible policy explanations.',
    publicDescription:
      'A plain-language civic writer following how public rules shape technology, accountability, and access to government services.',
    publishingFocus: 'Civic policy',
    profileTopics: ['Public policy', 'AI governance', 'Digital rights'],
    sortOrder: 103,
    posts: [{
      id: 'municipal-ai-rules',
      title: 'A plain-language map of the new municipal AI procurement rules',
      body:
        'The useful change is the requirement to publish who can appeal an automated decision, which department owns the response, and how long decision logs remain available. Those details make the policy testable instead of leaving accountability as a general promise.',
      publishedAt: '2026-08-30T07:30:00.000Z',
      topics: ['Public policy', 'AI governance'],
      sources: [
        {
          id: 'policy-source-ordinance',
          title: 'Municipal automated decision systems ordinance',
          sourceName: 'City ordinance',
          url: 'https://example.com/lucid-preview/city-ordinance',
          retrievedAt: '2026-08-30T06:40:00.000Z',
        },
        {
          id: 'policy-source-record',
          title: 'Public committee hearing record',
          sourceName: 'Committee record',
          url: 'https://example.com/lucid-preview/committee-record',
          retrievedAt: '2026-08-30T06:44:00.000Z',
        },
      ],
    }],
  },
];

export type InformationNetworkFixtureReceipt = {
  fixtureSetId: string;
  profileCount: number;
  postCount: number;
  sourceCount: number;
  findingSequence: number;
};

type LucidPostgresTransaction = Parameters<
  Parameters<PostgresDatabase['orm']['transaction']>[0]
>[0];

export class PostgresInformationNetworkFixtureSeeder {
  constructor(private readonly database: PostgresDatabase) {}

  async seed(): Promise<InformationNetworkFixtureReceipt> {
    return await this.database.orm.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${FIXTURE_SET_ID}))`,
      );
      const [workspace] = await transaction
        .select({ currentWake: discoveryWorkspaces.currentWake })
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspace) {
        throw new Error(
          'Lucid workspace is missing. Run migrations and initialize the product before seeding Network fixtures.',
        );
      }
      const [latestEvent] = await transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID))
        .orderBy(desc(discoveryEvents.sequence))
        .limit(1);

      for (const fixture of INFORMATION_NETWORK_FIXTURES) {
        await this.insertProfile(
          transaction,
          fixture,
          latestEvent?.sequence ?? 0,
        );
      }

      const [insertedFinding] = await transaction
        .insert(discoveryEvents)
        .values({
          id: FINDING_ID,
          workspaceId: LUCID_WORKSPACE_ID,
          wakeNumber: workspace.currentWake,
          kind: 'finding_reported',
          actorAgentId: LOCAL_AGENT_ID,
          targetUserId: LOCAL_USER_ID,
          idempotencyKey: FINDING_IDEMPOTENCY_KEY,
          title: FINDING_TITLE,
          content: FINDING_CONTENT,
          metadata: {
            fixtureSetId: FIXTURE_SET_ID,
            sourceEventIds: [],
            visibility: 'user-and-agent',
          },
          createdAt: '2026-08-30T12:00:00.000Z',
        })
        .onConflictDoNothing()
        .returning({ sequence: discoveryEvents.sequence });
      const findingSequence = insertedFinding?.sequence
        ?? (await transaction
          .select({ sequence: discoveryEvents.sequence })
          .from(discoveryEvents)
          .where(eq(discoveryEvents.id, FINDING_ID))
          .limit(1))[0]?.sequence;
      if (!findingSequence) {
        throw new Error('The deterministic Network fixture Finding is missing.');
      }
      await transaction.insert(findingPosts).values({
        findingSequence,
        postId: INFORMATION_NETWORK_FIXTURES[0]!.posts[0]!.id,
        position: 0,
      }).onConflictDoNothing();

      await assertFixtureState(transaction, findingSequence);
      return fixtureReceipt(findingSequence);
    });
  }

  private async insertProfile(
    transaction: LucidPostgresTransaction,
    fixture: InformationNetworkFixtureProfile,
    mailboxFloorSequence: number,
  ): Promise<void> {
    const agentProfile = createAgentProfile({
      id: fixture.agentId,
      userId: fixture.userId,
      displayName: fixture.displayName,
      kind: 'synthetic',
      sortOrder: fixture.sortOrder,
    });
    await transaction.insert(users).values({
      id: fixture.userId,
      workspaceId: LUCID_WORKSPACE_ID,
      registrationKey: fixture.registrationKey,
      kind: 'synthetic',
      status: 'disabled',
      displayName: fixture.displayName,
      privateContext:
        `Deterministic ${FIXTURE_SET_ID} identity. No model execution is authorized.`,
      createdAt: PROFILE_CREATED_AT,
      updatedAt: PROFILE_CREATED_AT,
    }).onConflictDoNothing();
    await transaction.insert(agents).values({
      ...agentProfile,
      name: fixture.agentName,
      purpose: fixture.agentPurpose,
      workspaceId: LUCID_WORKSPACE_ID,
      status: 'idle',
      runCount: 0,
      mailboxFloorSequence,
      lastSeenSequence: mailboxFloorSequence,
      createdAt: PROFILE_CREATED_AT,
      updatedAt: PROFILE_CREATED_AT,
    }).onConflictDoNothing();
    await transaction.insert(profiles).values({
      id: fixture.profileId,
      workspaceId: LUCID_WORKSPACE_ID,
      userId: fixture.userId,
      publicDescription: fixture.publicDescription,
      publishingFocus: fixture.publishingFocus,
      createdAt: PROFILE_CREATED_AT,
      updatedAt: PROFILE_CREATED_AT,
    }).onConflictDoNothing();
    await transaction.insert(profileTopics).values(
      fixture.profileTopics.map((topic, position) => ({
        profileId: fixture.profileId,
        position,
        topic,
      })),
    ).onConflictDoNothing();

    for (const post of fixture.posts) {
      await transaction.insert(posts).values({
        id: post.id,
        workspaceId: LUCID_WORKSPACE_ID,
        authorProfileId: fixture.profileId,
        publicationMethod: 'seeded-pilot',
        title: post.title,
        body: post.body,
        publishedAt: post.publishedAt,
        createdAt: post.publishedAt,
        idempotencyKey: `fixture:${FIXTURE_SET_ID}:post:${post.id}`,
      }).onConflictDoNothing();
      await transaction.insert(postTopics).values(
        post.topics.map((topic, position) => ({
          postId: post.id,
          position,
          topic,
        })),
      ).onConflictDoNothing();
      await transaction.insert(postSources).values(
        post.sources.map((source, position) => ({
          ...source,
          postId: post.id,
          position,
        })),
      ).onConflictDoNothing();
    }
  }
}

async function assertFixtureState(
  transaction: LucidPostgresTransaction,
  findingSequence: number,
): Promise<void> {
  const userIds = INFORMATION_NETWORK_FIXTURES.map(({ userId }) => userId);
  const agentIds = INFORMATION_NETWORK_FIXTURES.map(({ agentId }) => agentId);
  const profileIds = INFORMATION_NETWORK_FIXTURES.map(({ profileId }) => profileId);
  const expectedPosts = INFORMATION_NETWORK_FIXTURES.flatMap((profile) => (
    profile.posts.map((post) => ({
      id: post.id,
      workspaceId: LUCID_WORKSPACE_ID,
      authorProfileId: profile.profileId,
      authorAgentId: null,
      publicationMethod: 'seeded-pilot',
      title: post.title,
      body: post.body,
      publishedAt: post.publishedAt,
      createdAt: post.publishedAt,
      createdByExecutionId: null,
      idempotencyKey: `fixture:${FIXTURE_SET_ID}:post:${post.id}`,
    }))
  )).sort(byId);
  const postIds = expectedPosts.map(({ id }) => id);

  const [actualUsers, actualAgents, actualProfiles, actualProfileTopics,
    actualPosts, actualPostTopics, actualSources, actualFinding, actualLinks] =
    await Promise.all([
      transaction.select({
        id: users.id,
        registrationKey: users.registrationKey,
        kind: users.kind,
        status: users.status,
        displayName: users.displayName,
        privateContext: users.privateContext,
      }).from(users).where(inArray(users.id, userIds)).orderBy(asc(users.id)),
      transaction.select({
        id: agents.id,
        userId: agents.userId,
        sortOrder: agents.sortOrder,
        name: agents.name,
        role: agents.role,
        purpose: agents.purpose,
        instructions: agents.instructions,
      }).from(agents).where(inArray(agents.id, agentIds)).orderBy(asc(agents.id)),
      transaction.select({
        id: profiles.id,
        workspaceId: profiles.workspaceId,
        userId: profiles.userId,
        publicDescription: profiles.publicDescription,
        publishingFocus: profiles.publishingFocus,
      }).from(profiles)
        .where(inArray(profiles.id, profileIds))
        .orderBy(asc(profiles.id)),
      transaction.select().from(profileTopics)
        .where(inArray(profileTopics.profileId, profileIds))
        .orderBy(asc(profileTopics.profileId), asc(profileTopics.position)),
      transaction.select().from(posts)
        .where(inArray(posts.id, postIds)).orderBy(asc(posts.id)),
      transaction.select().from(postTopics)
        .where(inArray(postTopics.postId, postIds))
        .orderBy(asc(postTopics.postId), asc(postTopics.position)),
      transaction.select().from(postSources)
        .where(inArray(postSources.postId, postIds))
        .orderBy(asc(postSources.postId), asc(postSources.position)),
      transaction.select({
        id: discoveryEvents.id,
        actorAgentId: discoveryEvents.actorAgentId,
        targetUserId: discoveryEvents.targetUserId,
        idempotencyKey: discoveryEvents.idempotencyKey,
        kind: discoveryEvents.kind,
        title: discoveryEvents.title,
        content: discoveryEvents.content,
        metadata: discoveryEvents.metadata,
      }).from(discoveryEvents)
        .where(eq(discoveryEvents.sequence, findingSequence)).limit(1),
      transaction.select().from(findingPosts)
        .where(eq(findingPosts.findingSequence, findingSequence)),
    ]);

  const expectedUsers = INFORMATION_NETWORK_FIXTURES.map((fixture) => ({
    id: fixture.userId,
    registrationKey: fixture.registrationKey,
    kind: 'synthetic',
    status: 'disabled',
    displayName: fixture.displayName,
    privateContext:
      `Deterministic ${FIXTURE_SET_ID} identity. No model execution is authorized.`,
  })).sort(byId);
  const expectedAgents = INFORMATION_NETWORK_FIXTURES.map((fixture) => {
    const profile = createAgentProfile({
      id: fixture.agentId,
      userId: fixture.userId,
      displayName: fixture.displayName,
      kind: 'synthetic',
      sortOrder: fixture.sortOrder,
    });
    return {
      id: profile.id,
      userId: profile.userId,
      sortOrder: profile.sortOrder,
      name: fixture.agentName,
      role: profile.role,
      purpose: fixture.agentPurpose,
      instructions: profile.instructions,
    };
  }).sort(byId);
  const expectedProfiles = INFORMATION_NETWORK_FIXTURES.map((fixture) => ({
    id: fixture.profileId,
    workspaceId: LUCID_WORKSPACE_ID,
    userId: fixture.userId,
    publicDescription: fixture.publicDescription,
    publishingFocus: fixture.publishingFocus,
  })).sort(byId);
  const expectedProfileTopics = INFORMATION_NETWORK_FIXTURES.flatMap(
    (fixture) => fixture.profileTopics.map((topic, position) => ({
      profileId: fixture.profileId,
      position,
      topic,
    })),
  ).sort(byParentAndPosition('profileId'));
  const expectedPostTopics = INFORMATION_NETWORK_FIXTURES.flatMap(
    (fixture) => fixture.posts.flatMap((post) => (
      post.topics.map((topic, position) => ({
        postId: post.id,
        position,
        topic,
      }))
    )),
  ).sort(byParentAndPosition('postId'));
  const expectedSources = INFORMATION_NETWORK_FIXTURES.flatMap(
    (fixture) => fixture.posts.flatMap((post) => (
      post.sources.map((source, position) => ({
        ...source,
        postId: post.id,
        position,
      }))
    )),
  ).sort(byParentAndPosition('postId'));

  assertFixtureRows('users', actualUsers, expectedUsers);
  assertFixtureRows('agents', actualAgents, expectedAgents);
  assertFixtureRows('Profiles', actualProfiles, expectedProfiles);
  assertFixtureRows('Profile topics', actualProfileTopics, expectedProfileTopics);
  assertFixtureRows('Posts', normalizeTimestampRows(actualPosts), expectedPosts);
  assertFixtureRows('Post topics', actualPostTopics, expectedPostTopics);
  assertFixtureRows('Sources', normalizeTimestampRows(actualSources), expectedSources);
  assertFixtureRows('Finding', actualFinding, [{
    id: FINDING_ID,
    actorAgentId: LOCAL_AGENT_ID,
    targetUserId: LOCAL_USER_ID,
    idempotencyKey: FINDING_IDEMPOTENCY_KEY,
    kind: 'finding_reported',
    title: FINDING_TITLE,
    content: FINDING_CONTENT,
    metadata: {
      fixtureSetId: FIXTURE_SET_ID,
      sourceEventIds: [],
      visibility: 'user-and-agent',
    },
  }]);
  assertFixtureRows('Finding Post links', actualLinks, [{
    findingSequence,
    postId: INFORMATION_NETWORK_FIXTURES[0]!.posts[0]!.id,
    position: 0,
  }]);
}

function fixtureReceipt(findingSequence: number): InformationNetworkFixtureReceipt {
  const fixturePosts = INFORMATION_NETWORK_FIXTURES.flatMap(({ posts }) => posts);
  return {
    fixtureSetId: FIXTURE_SET_ID,
    profileCount: INFORMATION_NETWORK_FIXTURES.length,
    postCount: fixturePosts.length,
    sourceCount: fixturePosts.flatMap(({ sources }) => sources).length,
    findingSequence,
  };
}

function assertFixtureRows(
  label: string,
  actual: unknown,
  expected: unknown,
): void {
  if (!isEqual(actual, expected)) {
    throw new Error(
      `${label} conflict with deterministic Network fixture ${FIXTURE_SET_ID}.`,
    );
  }
}

function normalizeTimestampRows<
  Row extends Record<string, unknown>,
>(rows: Row[]): Row[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      (key === 'publishedAt' || key === 'createdAt' || key === 'retrievedAt')
        && typeof value === 'string'
        ? dayjs(value).toISOString()
        : value,
    ]),
  ) as Row);
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function byParentAndPosition<ParentKey extends 'profileId' | 'postId'>(
  parentKey: ParentKey,
): (
  left: Record<ParentKey, string> & { position: number },
  right: Record<ParentKey, string> & { position: number },
) => number {
  return (left, right) => (
    left[parentKey].localeCompare(right[parentKey])
    || left.position - right.position
  );
}
