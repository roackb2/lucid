/** PostgreSQL read adapter for first-class Network Profiles and Posts. */
import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  or,
  sql,
} from 'drizzle-orm';
import isEqual from 'lodash/isEqual.js';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import {
  postgresAgents as agents,
  postgresDiscoveryEvents as discoveryEvents,
  postgresFindingPosts as findingPosts,
  postgresNetworkPostSources as postSources,
  postgresNetworkPostTopics as postTopics,
  postgresNetworkPosts as posts,
  postgresNetworkProfileTopics as profileTopics,
  postgresNetworkProfiles as profiles,
  postgresUsers as users,
} from '../persistence/postgres/schema.js';
import { LUCID_WORKSPACE_ID } from '../workspace/workspace-identity.js';
import {
  InformationNetworkPublicationClaimError,
  InformationNetworkPublicationConflictError,
  type AgentTextPostPublicationClaim,
  type InformationNetworkPublicationStore,
  type InformationNetworkStore,
} from './store.js';
import {
  networkPostPublicationMethodSchema,
  type FindingNetworkPostView,
  type InformationNetworkFeedView,
  type PublishAgentTextPostReceipt,
  type SourceBackedTextPostDraft,
  type NetworkPostDetailView,
  type NetworkPostSearchResultView,
  type NetworkPostView,
  type NetworkProfileContentView,
  type NetworkProfileSummaryView,
} from './types.js';

type NetworkPostRow = typeof posts.$inferSelect;

type NetworkPostWithAuthorRow = {
  post: NetworkPostRow;
  profileId: string;
  displayName: string;
  publishingFocus: string;
  representativeAgentName: string;
};

const NETWORK_POST_SEARCH_EXCERPT_LENGTH = 400;

export class PostgresInformationNetworkStore
implements InformationNetworkStore, InformationNetworkPublicationStore {
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(
    private readonly database: PostgresDatabase,
    options: {
      now?: () => Date;
      createId?: () => string;
    } = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  /**
   * Commits one source-backed Post under the active Agent wake fence.
   *
   * The retry-stable wake ID, rather than the rotating execution attempt ID,
   * owns idempotency. A recovered attempt therefore observes the first commit
   * instead of duplicating its Post.
   */
  async publishAgentTextPost(
    claim: AgentTextPostPublicationClaim,
    draft: SourceBackedTextPostDraft,
  ): Promise<PublishAgentTextPostReceipt> {
    return await this.database.orm.transaction(async (transaction) => {
      const [agent] = await transaction
        .select({
          id: agents.id,
          userId: agents.userId,
          activeJobId: agents.activeJobId,
          activeWakeId: agents.activeWakeId,
          activeWakeNumber: agents.activeWakeNumber,
        })
        .from(agents)
        .where(and(
          eq(agents.workspaceId, LUCID_WORKSPACE_ID),
          eq(agents.userId, claim.userId),
          eq(agents.status, 'running'),
          eq(agents.activeWakeClaimToken, claim.executionId),
        ))
        .for('update')
        .limit(1);
      if (
        !agent
        || !agent.activeJobId
        || !agent.activeWakeId
        || agent.activeWakeNumber === null
      ) {
        throw new InformationNetworkPublicationClaimError();
      }

      const [activeUser] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.workspaceId, LUCID_WORKSPACE_ID),
          eq(users.id, claim.userId),
          eq(users.status, 'active'),
        ))
        .limit(1);
      const [profile] = await transaction
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(
          eq(profiles.workspaceId, LUCID_WORKSPACE_ID),
          eq(profiles.userId, claim.userId),
        ))
        .limit(1);
      if (!activeUser || !profile) {
        throw new InformationNetworkPublicationClaimError();
      }

      const idempotencyKey = `${agent.activeWakeId}:publish-text-post`;
      const [existing] = await transaction
        .select()
        .from(posts)
        .where(eq(posts.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        const existingTopics = await transaction
          .select({ topic: postTopics.topic })
          .from(postTopics)
          .where(eq(postTopics.postId, existing.id))
          .orderBy(asc(postTopics.position));
        const existingSources = await transaction
          .select({
            title: postSources.title,
            sourceName: postSources.sourceName,
            url: postSources.url,
          })
          .from(postSources)
          .where(eq(postSources.postId, existing.id))
          .orderBy(asc(postSources.position));
        const matchesOriginalPublication = (
          existing.workspaceId === LUCID_WORKSPACE_ID
          && existing.authorProfileId === profile.id
          && existing.authorAgentId === agent.id
          && existing.createdByAgentJobId === agent.activeJobId
          && existing.createdByAgentJobRunRequestId === agent.activeWakeId
          && existing.publicationMethod === 'agent'
          && existing.title === draft.title
          && existing.body === draft.body
          && isEqual(existingTopics.map(({ topic }) => topic), draft.topics)
          && isEqual(existingSources, draft.sources)
        );
        if (!matchesOriginalPublication) {
          throw new InformationNetworkPublicationConflictError();
        }
        return {
          outcome: 'already-published',
          postId: existing.id,
          publishedAt: dayjs(existing.publishedAt).toISOString(),
        };
      }

      const publishedAt = dayjs(this.#now()).toISOString();
      const postId = `post_${this.#createId()}`;
      await transaction.insert(posts).values({
        id: postId,
        workspaceId: LUCID_WORKSPACE_ID,
        authorProfileId: profile.id,
        authorAgentId: agent.id,
        createdByAgentJobId: agent.activeJobId,
        createdByAgentJobRunRequestId: agent.activeWakeId,
        publicationMethod: 'agent',
        title: draft.title,
        body: draft.body,
        publishedAt,
        createdAt: publishedAt,
        createdByExecutionId: claim.executionId,
        idempotencyKey,
      });
      await transaction.insert(postTopics).values(draft.topics.map(
        (topic, position) => ({ postId, position, topic }),
      ));
      await transaction.insert(postSources).values(draft.sources.map(
        (source, position) => ({
          id: `source_${this.#createId()}`,
          postId,
          position,
          ...source,
          retrievedAt: publishedAt,
        }),
      ));
      return { outcome: 'published', postId, publishedAt };
    });
  }

  async readAgentJobRunPublication(
    agentJobRunRequestId: string,
  ): Promise<{ postId: string } | undefined> {
    const [post] = await this.database.orm
      .select({ postId: posts.id })
      .from(posts)
      .where(and(
        eq(posts.workspaceId, LUCID_WORKSPACE_ID),
        eq(posts.createdByAgentJobRunRequestId, agentJobRunRequestId),
      ))
      .limit(1);
    return post;
  }

  async readFeed(limit: number): Promise<InformationNetworkFeedView> {
    assertReadLimit(limit);
    const [rows, postCountRows, profileCountRows] = await Promise.all([
      this.database.orm
        .select({
          post: posts,
          profileId: profiles.id,
          displayName: users.displayName,
          publishingFocus: profiles.publishingFocus,
          representativeAgentName: agents.name,
        })
        .from(posts)
        .innerJoin(profiles, eq(profiles.id, posts.authorProfileId))
        .innerJoin(users, eq(users.id, profiles.userId))
        .innerJoin(agents, eq(agents.userId, users.id))
        .where(and(
          eq(posts.workspaceId, LUCID_WORKSPACE_ID),
          eq(profiles.workspaceId, LUCID_WORKSPACE_ID),
          eq(users.workspaceId, LUCID_WORKSPACE_ID),
          eq(agents.workspaceId, LUCID_WORKSPACE_ID),
        ))
        .orderBy(desc(posts.publishedAt), desc(posts.id))
        .limit(limit),
      this.database.orm
        .select({ value: count() })
        .from(posts)
        .where(eq(posts.workspaceId, LUCID_WORKSPACE_ID)),
      this.database.orm
        .select({ value: count() })
        .from(profiles)
        .where(eq(profiles.workspaceId, LUCID_WORKSPACE_ID)),
    ]);
    const postById = await this.readPostViews(rows.map(({ post }) => post));

    return {
      entries: rows.map((row) => ({
        post: requirePostView(postById, row.post.id),
        author: toProfileSummary(row),
      })),
      postCount: postCountRows[0]?.value ?? 0,
      profileCount: profileCountRows[0]?.value ?? 0,
    };
  }

  async readPost(postId: string): Promise<NetworkPostDetailView | undefined> {
    const [row] = await this.database.orm
      .select({
        post: posts,
        profileId: profiles.id,
        displayName: users.displayName,
        publishingFocus: profiles.publishingFocus,
        representativeAgentName: agents.name,
      })
      .from(posts)
      .innerJoin(profiles, eq(profiles.id, posts.authorProfileId))
      .innerJoin(users, eq(users.id, profiles.userId))
      .innerJoin(agents, eq(agents.userId, users.id))
      .where(and(
        eq(posts.id, postId),
        eq(posts.workspaceId, LUCID_WORKSPACE_ID),
        eq(profiles.workspaceId, LUCID_WORKSPACE_ID),
        eq(users.workspaceId, LUCID_WORKSPACE_ID),
        eq(agents.workspaceId, LUCID_WORKSPACE_ID),
      ))
      .limit(1);
    if (!row) {
      return undefined;
    }
    const postById = await this.readPostViews([row.post]);
    return {
      post: requirePostView(postById, row.post.id),
      author: toProfileSummary(row),
    };
  }

  async searchPosts(
    query: string,
    limit: number,
  ): Promise<NetworkPostSearchResultView[]> {
    assertReadLimit(limit);
    const searchQuery = sql`websearch_to_tsquery(
      'english',
      ${toAnyTermWebSearchExpression(query)}
    )`;
    const postSearchDocument = sql`(
      setweight(to_tsvector('english', coalesce(${posts.title}, '')), 'A')
      || setweight(to_tsvector('english', coalesce(${posts.body}, '')), 'B')
    )`;
    const rows = await this.database.orm
      .select({
        post: posts,
        profileId: profiles.id,
        displayName: users.displayName,
        publishingFocus: profiles.publishingFocus,
        representativeAgentName: agents.name,
      })
      .from(posts)
      .innerJoin(profiles, eq(profiles.id, posts.authorProfileId))
      .innerJoin(users, eq(users.id, profiles.userId))
      .innerJoin(agents, eq(agents.userId, users.id))
      .where(and(
        eq(posts.workspaceId, LUCID_WORKSPACE_ID),
        eq(profiles.workspaceId, LUCID_WORKSPACE_ID),
        eq(users.workspaceId, LUCID_WORKSPACE_ID),
        eq(agents.workspaceId, LUCID_WORKSPACE_ID),
        or(
          sql`${postSearchDocument} @@ ${searchQuery}`,
          exists(
            this.database.orm
              .select({ postId: postTopics.postId })
              .from(postTopics)
              .where(and(
                eq(postTopics.postId, posts.id),
                sql`to_tsvector('english', ${postTopics.topic}) @@ ${searchQuery}`,
              )),
          ),
        ),
      ))
      .orderBy(
        desc(sql`ts_rank(${postSearchDocument}, ${searchQuery})`),
        desc(posts.publishedAt),
        desc(posts.id),
      )
      .limit(limit);
    const postById = await this.readPostViews(rows.map(({ post }) => post));

    return rows.map((row) => {
      const post = requirePostView(postById, row.post.id);
      return {
        postId: post.id,
        title: post.title,
        excerpt: excerptForBody(post.body),
        publishedAt: post.publishedAt,
        publicationMethod: post.publicationMethod,
        topics: post.topics,
        author: {
          id: row.profileId,
          displayName: row.displayName,
        },
      };
    });
  }

  async readProfile(
    profileId: string,
    recentPostLimit: number,
  ): Promise<NetworkProfileContentView | undefined> {
    assertReadLimit(recentPostLimit);
    const [profile] = await this.database.orm
      .select({
        id: profiles.id,
        displayName: users.displayName,
        publicDescription: profiles.publicDescription,
        publishingFocus: profiles.publishingFocus,
        representativeAgentId: agents.id,
        representativeAgentName: agents.name,
        representativeAgentPurpose: agents.purpose,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .innerJoin(agents, eq(agents.userId, users.id))
      .where(and(
        eq(profiles.id, profileId),
        eq(profiles.workspaceId, LUCID_WORKSPACE_ID),
        eq(users.workspaceId, LUCID_WORKSPACE_ID),
        eq(agents.workspaceId, LUCID_WORKSPACE_ID),
      ))
      .limit(1);
    if (!profile) {
      return undefined;
    }

    const [profileTopicRows, postRows] = await Promise.all([
      this.database.orm
        .select({ topic: profileTopics.topic })
        .from(profileTopics)
        .where(eq(profileTopics.profileId, profileId))
        .orderBy(asc(profileTopics.position)),
      this.database.orm
        .select()
        .from(posts)
        .where(and(
          eq(posts.workspaceId, LUCID_WORKSPACE_ID),
          eq(posts.authorProfileId, profileId),
        ))
        .orderBy(desc(posts.publishedAt), desc(posts.id))
        .limit(recentPostLimit),
    ]);
    const postById = await this.readPostViews(postRows);

    return {
      profile: {
        ...profile,
        initials: initialsForDisplayName(profile.displayName),
        topics: profileTopicRows.map(({ topic }) => topic),
      },
      recentPosts: postRows.map(({ id }) => requirePostView(postById, id)),
    };
  }

  async readFindingPosts(
    userId: string,
    findingSequences: readonly number[],
  ): Promise<ReadonlyMap<number, FindingNetworkPostView[]>> {
    const sequences = [...new Set(findingSequences)]
      .filter((sequence) => Number.isSafeInteger(sequence) && sequence > 0);
    if (!sequences.length) {
      return new Map();
    }

    const rows = await this.database.orm
      .select({
        findingSequence: findingPosts.findingSequence,
        position: findingPosts.position,
        id: posts.id,
        title: posts.title,
        publishedAt: posts.publishedAt,
        publicationMethod: posts.publicationMethod,
        profileId: profiles.id,
        displayName: users.displayName,
      })
      .from(findingPosts)
      .innerJoin(
        discoveryEvents,
        eq(discoveryEvents.sequence, findingPosts.findingSequence),
      )
      .innerJoin(posts, eq(posts.id, findingPosts.postId))
      .innerJoin(profiles, eq(profiles.id, posts.authorProfileId))
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(and(
        inArray(findingPosts.findingSequence, sequences),
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetUserId, userId),
        eq(posts.workspaceId, LUCID_WORKSPACE_ID),
        eq(profiles.workspaceId, LUCID_WORKSPACE_ID),
        eq(users.workspaceId, LUCID_WORKSPACE_ID),
      ))
      .orderBy(
        asc(findingPosts.findingSequence),
        asc(findingPosts.position),
      );

    return rows.reduce((byFinding, row) => {
      const existing = byFinding.get(row.findingSequence) ?? [];
      byFinding.set(row.findingSequence, [
        ...existing,
        {
          id: row.id,
          title: row.title,
          publishedAt: row.publishedAt,
          publicationMethod: networkPostPublicationMethodSchema.parse(
            row.publicationMethod,
          ),
          author: {
            id: row.profileId,
            displayName: row.displayName,
          },
        },
      ]);
      return byFinding;
    }, new Map<number, FindingNetworkPostView[]>());
  }

  private async readPostViews(
    postRows: NetworkPostRow[],
  ): Promise<ReadonlyMap<string, NetworkPostView>> {
    const postIds = postRows.map(({ id }) => id);
    if (!postIds.length) {
      return new Map();
    }
    const [topicRows, sourceRows] = await Promise.all([
      this.database.orm
        .select()
        .from(postTopics)
        .where(inArray(postTopics.postId, postIds))
        .orderBy(asc(postTopics.postId), asc(postTopics.position)),
      this.database.orm
        .select()
        .from(postSources)
        .where(inArray(postSources.postId, postIds))
        .orderBy(asc(postSources.postId), asc(postSources.position)),
    ]);
    const topicsByPost = topicRows.reduce((byPost, row) => {
      byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), row.topic]);
      return byPost;
    }, new Map<string, string[]>());
    const sourcesByPost = sourceRows.reduce((byPost, row) => {
      byPost.set(row.postId, [
        ...(byPost.get(row.postId) ?? []),
        {
          id: row.id,
          title: row.title,
          sourceName: row.sourceName,
          url: row.url,
          retrievedAt: row.retrievedAt,
        },
      ]);
      return byPost;
    }, new Map<string, NetworkPostView['sources']>());

    return new Map(postRows.map((row) => [
      row.id,
      {
        id: row.id,
        title: row.title,
        body: row.body,
        publishedAt: row.publishedAt,
        publicationMethod: networkPostPublicationMethodSchema.parse(
          row.publicationMethod,
        ),
        topics: topicsByPost.get(row.id) ?? [],
        sources: sourcesByPost.get(row.id) ?? [],
      },
    ]));
  }
}

/**
 * Turns an agent's natural-language query into a safe any-term expression.
 * PostgreSQL still owns parsing, stop-word removal, and English stemming.
 */
function toAnyTermWebSearchExpression(query: string): string {
  return (query.match(/[\p{L}\p{N}]+/gu) ?? []).join(' OR ');
}

function toProfileSummary(
  row: Omit<NetworkPostWithAuthorRow, 'post'>,
): NetworkProfileSummaryView {
  return {
    id: row.profileId,
    displayName: row.displayName,
    initials: initialsForDisplayName(row.displayName),
    publishingFocus: row.publishingFocus,
    representativeAgentName: row.representativeAgentName,
  };
}

function initialsForDisplayName(displayName: string): string {
  const words = displayName.trim().split(/\s+/u);
  const initialCharacters = words.length === 1
    ? Array.from(words[0]!).slice(0, 2)
    : words.slice(0, 2).map((word) => Array.from(word)[0]!);
  return initialCharacters.join('').toLocaleUpperCase();
}

function requirePostView(
  postById: ReadonlyMap<string, NetworkPostView>,
  postId: string,
): NetworkPostView {
  const post = postById.get(postId);
  if (!post) {
    throw new Error(`Network Post projection is incomplete: ${postId}`);
  }
  return post;
}

function assertReadLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Information Network read limit must be between 1 and 100.');
  }
}

function excerptForBody(body: string): string {
  if (body.length <= NETWORK_POST_SEARCH_EXCERPT_LENGTH) {
    return body;
  }
  return `${body.slice(0, NETWORK_POST_SEARCH_EXCERPT_LENGTH - 1).trimEnd()}…`;
}
