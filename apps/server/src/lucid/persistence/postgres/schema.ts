/**
 * PostgreSQL persistence model for Lucid's shared hosted workspace.
 *
 * The `lucid` schema contains product-owned user, agent, and
 * immutable event state. Released Heddle adapters own their separate `heddle`
 * schema and bundled migrations; this module does not redeclare those tables.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { DiscoveryEventMetadata } from '../../discovery-types.js';

export const lucidPostgresSchema = pgSchema('lucid');

const timestampColumn = (name: string) => timestamp(name, {
  mode: 'string',
  withTimezone: true,
});

export const postgresDiscoveryWorkspaces = lucidPostgresSchema.table(
  'discovery_workspaces',
  {
    id: text('id').primaryKey(),
    // Every row uses TRUE, so the unique constraint permits only one active
    // workspace generation while retaining its stable domain identifier.
    singleton: boolean('singleton').notNull().default(true),
    versionId: text('version_id').notNull(),
    currentWake: bigint('current_wake', { mode: 'number' }).notNull(),
    backgroundChecksEnabled: boolean('background_checks_enabled')
      .notNull()
      .default(false),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('discovery_workspaces_single_generation_idx')
      .on(table.singleton),
    check(
      'discovery_workspaces_singleton_true',
      sql`${table.singleton} = true`,
    ),
    check(
      'discovery_workspaces_current_wake_nonnegative',
      sql`${table.currentWake} >= 0`,
    ),
  ],
);

export const postgresUsers = lucidPostgresSchema.table(
  'users',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => postgresDiscoveryWorkspaces.id, {
        onDelete: 'cascade',
      }),
    registrationKey: text('registration_key'),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('active'),
    displayName: text('display_name').notNull(),
    privateContext: text('private_context').notNull(),
    contextConsentAt: timestampColumn('context_consent_at'),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('users_workspace_idx').on(table.workspaceId),
    uniqueIndex('users_registration_key_idx').on(table.registrationKey),
    check('users_kind_valid', sql`${table.kind} in ('human', 'synthetic')`),
    check(
      'users_status_valid',
      sql`${table.status} in ('active', 'disabled', 'retired')`,
    ),
    check(
      'users_human_consent_required',
      sql`${table.kind} <> 'human' or ${table.contextConsentAt} is not null`,
    ),
  ],
);

/** Immutable provider subject bindings; email is profile data, never identity. */
export const postgresUserIdentityBindings = lucidPostgresSchema.table(
  'user_identity_bindings',
  {
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => postgresUsers.id, { onDelete: 'cascade' }),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'user_identity_bindings_pk',
      columns: [table.issuer, table.subject],
    }),
    uniqueIndex('user_identity_bindings_user_idx')
      .on(table.userId),
    check(
      'user_identity_bindings_issuer_valid',
      sql`char_length(${table.issuer}) between 1 and 512 and ${table.issuer} = btrim(${table.issuer})`,
    ),
    check(
      'user_identity_bindings_subject_valid',
      sql`char_length(${table.subject}) between 1 and 512 and ${table.subject} = btrim(${table.subject})`,
    ),
  ],
);

export const postgresAgents = lucidPostgresSchema.table(
  'agents',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => postgresDiscoveryWorkspaces.id, {
        onDelete: 'cascade',
      }),
    userId: text('user_id')
      .notNull()
      .references(() => postgresUsers.id, { onDelete: 'cascade' }),
    sortOrder: bigint('sort_order', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    role: text('role').notNull(),
    color: text('color').notNull(),
    purpose: text('purpose').notNull(),
    instructions: text('instructions').notNull(),
    status: text('status').notNull(),
    runCount: bigint('run_count', { mode: 'number' }).notNull(),
    mailboxFloorSequence: bigint('mailbox_floor_sequence', { mode: 'number' })
      .notNull()
      .default(0),
    lastSeenSequence: bigint('last_seen_sequence', { mode: 'number' })
      .notNull(),
    /** The product job currently bound to the Agent's execution fence. */
    activeJobId: text('active_job_id')
      .references((): AnyPgColumn => postgresAgentJobs.id, {
        onDelete: 'set null',
      }),
    activeWakeId: text('active_wake_id'),
    activeWakeClaimToken: text('active_wake_claim_token'),
    activeWakeNumber: bigint('active_wake_number', { mode: 'number' }),
    activeWakeHorizon: bigint('active_wake_horizon', { mode: 'number' }),
    lastRunAt: timestampColumn('last_run_at'),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('agents_workspace_sort_idx').on(
      table.workspaceId,
      table.sortOrder,
    ),
    uniqueIndex('agents_user_idx')
      .on(table.userId),
    check(
      'agents_status_valid',
      sql`${table.status} in ('idle', 'running', 'error')`,
    ),
    check(
      'agents_counters_nonnegative',
      sql`${table.sortOrder} >= 0 and ${table.runCount} >= 0 and ${table.mailboxFloorSequence} >= 0 and ${table.lastSeenSequence} >= 0`,
    ),
    check(
      'agents_wake_claim_complete',
      sql`(
        ${table.activeWakeId} is null
        and ${table.activeWakeClaimToken} is null
        and ${table.activeWakeNumber} is null
        and ${table.activeWakeHorizon} is null
      ) or (
        ${table.activeWakeId} is not null
        and ${table.activeWakeClaimToken} is not null
        and ${table.activeWakeNumber} is not null
        and ${table.activeWakeHorizon} is not null
      )`,
    ),
    check(
      'agents_active_job_requires_wake',
      sql`${table.activeJobId} is null or ${table.activeWakeId} is not null`,
    ),
  ],
);

/** Product-owned intent for one durable representative-Agent workflow. */
export const postgresAgentJobs = lucidPostgresSchema.table(
  'agent_jobs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => postgresDiscoveryWorkspaces.id, {
        onDelete: 'cascade',
      }),
    agentId: text('agent_id')
      .notNull()
      .references(() => postgresAgents.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    instructions: text('instructions').notNull(),
    cadenceMs: bigint('cadence_ms', { mode: 'number' }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    scheduleMode: text('schedule_mode').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('agent_jobs_workspace_idx').on(table.workspaceId, table.id),
    index('agent_jobs_agent_idx').on(table.agentId, table.id),
    check(
      'agent_jobs_kind_valid',
      sql`${table.kind} in ('interest-discovery', 'information-network-publishing')`,
    ),
    check(
      'agent_jobs_name_valid',
      sql`char_length(${table.name}) between 1 and 120 and ${table.name} = btrim(${table.name})`,
    ),
    check(
      'agent_jobs_instructions_valid',
      sql`char_length(${table.instructions}) between 1 and 12000 and ${table.instructions} = btrim(${table.instructions})`,
    ),
    check(
      'agent_jobs_cadence_positive',
      sql`${table.cadenceMs} > 0`,
    ),
    check(
      'agent_jobs_schedule_mode_valid',
      sql`${table.scheduleMode} in ('manual', 'scheduled')`,
    ),
  ],
);

/** Private publishing direction owned by one publishing job. */
export const postgresAgentJobPublishingPreferences = lucidPostgresSchema.table(
  'agent_job_publishing_preferences',
  {
    agentJobId: text('agent_job_id')
      .primaryKey()
      .references(() => postgresAgentJobs.id, { onDelete: 'cascade' }),
    region: text('region'),
    intendedAudience: text('intended_audience'),
    tone: text('tone'),
    sourceGuidance: text('source_guidance'),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    check(
      'agent_job_publishing_preferences_region_valid',
      sql`${table.region} is null or (char_length(${table.region}) between 1 and 240 and ${table.region} = btrim(${table.region}))`,
    ),
    check(
      'agent_job_publishing_preferences_audience_valid',
      sql`${table.intendedAudience} is null or (char_length(${table.intendedAudience}) between 1 and 1000 and ${table.intendedAudience} = btrim(${table.intendedAudience}))`,
    ),
    check(
      'agent_job_publishing_preferences_tone_valid',
      sql`${table.tone} is null or (char_length(${table.tone}) between 1 and 1000 and ${table.tone} = btrim(${table.tone}))`,
    ),
    check(
      'agent_job_publishing_preferences_source_guidance_valid',
      sql`${table.sourceGuidance} is null or (char_length(${table.sourceGuidance}) between 1 and 4000 and ${table.sourceGuidance} = btrim(${table.sourceGuidance}))`,
    ),
  ],
);

export const postgresAgentJobPublishingTopics = lucidPostgresSchema.table(
  'agent_job_publishing_topics',
  {
    agentJobId: text('agent_job_id')
      .notNull()
      .references(() => postgresAgentJobPublishingPreferences.agentJobId, {
        onDelete: 'cascade',
      }),
    position: integer('position').notNull(),
    topic: text('topic').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'agent_job_publishing_topics_pk',
      columns: [table.agentJobId, table.topic],
    }),
    uniqueIndex('agent_job_publishing_topics_position_idx')
      .on(table.agentJobId, table.position),
    check(
      'agent_job_publishing_topics_position_nonnegative',
      sql`${table.position} >= 0`,
    ),
    check(
      'agent_job_publishing_topics_topic_valid',
      sql`char_length(${table.topic}) between 1 and 120 and ${table.topic} = btrim(${table.topic})`,
    ),
  ],
);

/** Durable, coalesced intent for one explicitly requested Agent-job run. */
export const postgresAgentJobRunRequests = lucidPostgresSchema.table(
  'agent_job_run_requests',
  {
    id: text('id').primaryKey(),
    agentJobId: text('agent_job_id')
      .notNull()
      .references(() => postgresAgentJobs.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    outcome: text('outcome'),
    currentExecutionId: text('current_execution_id'),
    outcomeSummary: text('outcome_summary'),
    requestedAt: timestampColumn('requested_at').notNull(),
    claimedAt: timestampColumn('claimed_at'),
    settledAt: timestampColumn('settled_at'),
  },
  (table) => [
    index('agent_job_run_requests_history_idx').on(
      table.agentJobId,
      table.requestedAt,
      table.id,
    ),
    uniqueIndex('agent_job_run_requests_active_idx')
      .on(table.agentJobId)
      .where(sql`${table.state} in ('requested', 'claimed')`),
    check(
      'agent_job_run_requests_state_valid',
      sql`${table.state} in ('requested', 'claimed', 'settled')`,
    ),
    check(
      'agent_job_run_requests_outcome_valid',
      sql`${table.outcome} is null or ${table.outcome} in ('published', 'no-post', 'failed')`,
    ),
    check(
      'agent_job_run_requests_lifecycle_valid',
      sql`(
        ${table.state} = 'requested'
        and ${table.currentExecutionId} is null
        and ${table.claimedAt} is null
        and ${table.outcome} is null
        and ${table.outcomeSummary} is null
        and ${table.settledAt} is null
      ) or (
        ${table.state} = 'claimed'
        and ${table.currentExecutionId} is not null
        and ${table.claimedAt} is not null
        and ${table.outcome} is null
        and ${table.outcomeSummary} is null
        and ${table.settledAt} is null
      ) or (
        ${table.state} = 'settled'
        and ${table.currentExecutionId} is not null
        and ${table.claimedAt} is not null
        and ${table.outcome} is not null
        and ${table.settledAt} is not null
      )`,
    ),
    check(
      'agent_job_run_requests_outcome_summary_valid',
      sql`${table.outcomeSummary} is null or (char_length(${table.outcomeSummary}) between 1 and 2000 and ${table.outcomeSummary} = btrim(${table.outcomeSummary}))`,
    ),
  ],
);

export const postgresDiscoveryEvents = lucidPostgresSchema.table(
  'discovery_events',
  {
    sequence: bigserial('sequence', { mode: 'number' }).primaryKey(),
    id: text('id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => postgresDiscoveryWorkspaces.id, {
        onDelete: 'cascade',
      }),
    wakeNumber: bigint('wake_number', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    actorAgentId: text('actor_agent_id'),
    targetAgentId: text('target_agent_id'),
    targetUserId: text('target_user_id'),
    replyToSequence: bigint('reply_to_sequence', { mode: 'number' }),
    idempotencyKey: text('idempotency_key'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata')
      .$type<DiscoveryEventMetadata>()
      .notNull()
      .default({}),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('discovery_events_id_idx').on(table.id),
    uniqueIndex('discovery_events_idempotency_idx').on(table.idempotencyKey),
    index('discovery_events_workspace_sequence_idx').on(
      table.workspaceId,
      table.sequence,
    ),
    index('discovery_events_actor_idx').on(table.actorAgentId, table.sequence),
    index('discovery_events_target_agent_idx').on(
      table.targetAgentId,
      table.sequence,
    ),
    index('discovery_events_target_user_idx').on(
      table.targetUserId,
      table.sequence,
    ),
    index('discovery_events_reply_idx').on(
      table.replyToSequence,
      table.sequence,
    ),
    index('discovery_events_kind_sequence_idx').on(
      table.workspaceId,
      table.kind,
      table.sequence,
    ),
    index('discovery_events_metadata_gin_idx').using('gin', table.metadata),
    check('discovery_events_wake_nonnegative', sql`${table.wakeNumber} >= 0`),
  ],
);

/** Network-visible identity projected from one private Lucid user. */
export const postgresNetworkProfiles = lucidPostgresSchema.table(
  'network_profiles',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => postgresDiscoveryWorkspaces.id, {
        onDelete: 'cascade',
      }),
    userId: text('user_id')
      .notNull()
      .references(() => postgresUsers.id, { onDelete: 'cascade' }),
    publicDescription: text('public_description').notNull(),
    publishingFocus: text('publishing_focus').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('network_profiles_workspace_idx').on(table.workspaceId),
    uniqueIndex('network_profiles_user_idx').on(table.userId),
    check(
      'network_profiles_description_valid',
      sql`char_length(${table.publicDescription}) between 1 and 2000 and ${table.publicDescription} = btrim(${table.publicDescription})`,
    ),
    check(
      'network_profiles_focus_valid',
      sql`char_length(${table.publishingFocus}) between 1 and 120 and ${table.publishingFocus} = btrim(${table.publishingFocus})`,
    ),
  ],
);

export const postgresNetworkProfileTopics = lucidPostgresSchema.table(
  'network_profile_topics',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => postgresNetworkProfiles.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    topic: text('topic').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'network_profile_topics_pk',
      columns: [table.profileId, table.topic],
    }),
    uniqueIndex('network_profile_topics_position_idx')
      .on(table.profileId, table.position),
    index('network_profile_topics_topic_idx').on(table.topic, table.profileId),
    check(
      'network_profile_topics_position_nonnegative',
      sql`${table.position} >= 0`,
    ),
    check(
      'network_profile_topics_topic_valid',
      sql`char_length(${table.topic}) between 1 and 120 and ${table.topic} = btrim(${table.topic})`,
    ),
  ],
);

export const postgresNetworkPosts = lucidPostgresSchema.table(
  'network_posts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => postgresDiscoveryWorkspaces.id, {
        onDelete: 'cascade',
      }),
    authorProfileId: text('author_profile_id')
      .notNull()
      .references(() => postgresNetworkProfiles.id, { onDelete: 'cascade' }),
    authorAgentId: text('author_agent_id')
      .references(() => postgresAgents.id, { onDelete: 'restrict' }),
    createdByAgentJobId: text('created_by_agent_job_id')
      .references(() => postgresAgentJobs.id, { onDelete: 'restrict' }),
    createdByAgentJobRunRequestId: text('created_by_agent_job_run_request_id')
      .references(() => postgresAgentJobRunRequests.id, {
        onDelete: 'restrict',
      }),
    publicationMethod: text('publication_method').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    publishedAt: timestampColumn('published_at').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    createdByExecutionId: text('created_by_execution_id'),
    idempotencyKey: text('idempotency_key'),
  },
  (table) => [
    index('network_posts_feed_idx').on(
      table.workspaceId,
      table.publishedAt,
      table.id,
    ),
    index('network_posts_profile_idx').on(
      table.authorProfileId,
      table.publishedAt,
      table.id,
    ),
    uniqueIndex('network_posts_idempotency_idx').on(table.idempotencyKey),
    uniqueIndex('network_posts_agent_job_run_request_idx')
      .on(table.createdByAgentJobRunRequestId),
    check(
      'network_posts_publication_method_valid',
      sql`${table.publicationMethod} in ('seeded-pilot', 'agent')`,
    ),
    check(
      'network_posts_publication_provenance_valid',
      sql`(
        ${table.publicationMethod} = 'agent'
        and ${table.authorAgentId} is not null
        and ${table.createdByExecutionId} is not null
      ) or (
        ${table.publicationMethod} = 'seeded-pilot'
        and ${table.authorAgentId} is null
        and ${table.createdByExecutionId} is null
      )`,
    ),
    check(
      'network_posts_title_valid',
      sql`char_length(${table.title}) between 1 and 240 and ${table.title} = btrim(${table.title})`,
    ),
    check(
      'network_posts_body_valid',
      sql`char_length(${table.body}) between 1 and 20000 and ${table.body} = btrim(${table.body})`,
    ),
  ],
);

export const postgresNetworkPostTopics = lucidPostgresSchema.table(
  'network_post_topics',
  {
    postId: text('post_id')
      .notNull()
      .references(() => postgresNetworkPosts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    topic: text('topic').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'network_post_topics_pk',
      columns: [table.postId, table.topic],
    }),
    uniqueIndex('network_post_topics_position_idx')
      .on(table.postId, table.position),
    index('network_post_topics_topic_idx').on(table.topic, table.postId),
    check(
      'network_post_topics_position_nonnegative',
      sql`${table.position} >= 0`,
    ),
    check(
      'network_post_topics_topic_valid',
      sql`char_length(${table.topic}) between 1 and 120 and ${table.topic} = btrim(${table.topic})`,
    ),
  ],
);

export const postgresNetworkPostSources = lucidPostgresSchema.table(
  'network_post_sources',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => postgresNetworkPosts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    sourceName: text('source_name').notNull(),
    url: text('url').notNull(),
    retrievedAt: timestampColumn('retrieved_at'),
  },
  (table) => [
    uniqueIndex('network_post_sources_position_idx')
      .on(table.postId, table.position),
    uniqueIndex('network_post_sources_url_idx').on(table.postId, table.url),
    check(
      'network_post_sources_position_nonnegative',
      sql`${table.position} >= 0`,
    ),
    check(
      'network_post_sources_title_valid',
      sql`char_length(${table.title}) between 1 and 500 and ${table.title} = btrim(${table.title})`,
    ),
    check(
      'network_post_sources_name_valid',
      sql`char_length(${table.sourceName}) between 1 and 200 and ${table.sourceName} = btrim(${table.sourceName})`,
    ),
    check(
      'network_post_sources_url_valid',
      sql`char_length(${table.url}) between 1 and 2048 and ${table.url} = btrim(${table.url})`,
    ),
  ],
);

/** Normalized private Finding-to-public-Post provenance. */
export const postgresFindingPosts = lucidPostgresSchema.table(
  'finding_posts',
  {
    findingSequence: bigint('finding_sequence', { mode: 'number' })
      .notNull()
      .references(() => postgresDiscoveryEvents.sequence, {
        onDelete: 'cascade',
      }),
    postId: text('post_id')
      .notNull()
      .references(() => postgresNetworkPosts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'finding_posts_pk',
      columns: [table.findingSequence, table.postId],
    }),
    uniqueIndex('finding_posts_position_idx')
      .on(table.findingSequence, table.position),
    index('finding_posts_post_idx').on(table.postId, table.findingSequence),
    check(
      'finding_posts_position_nonnegative',
      sql`${table.position} >= 0`,
    ),
  ],
);

export const lucidPostgresTables = {
  discoveryWorkspaces: postgresDiscoveryWorkspaces,
  users: postgresUsers,
  userIdentityBindings: postgresUserIdentityBindings,
  agents: postgresAgents,
  agentJobs: postgresAgentJobs,
  agentJobPublishingPreferences: postgresAgentJobPublishingPreferences,
  agentJobPublishingTopics: postgresAgentJobPublishingTopics,
  agentJobRunRequests: postgresAgentJobRunRequests,
  discoveryEvents: postgresDiscoveryEvents,
  networkProfiles: postgresNetworkProfiles,
  networkProfileTopics: postgresNetworkProfileTopics,
  networkPosts: postgresNetworkPosts,
  networkPostTopics: postgresNetworkPostTopics,
  networkPostSources: postgresNetworkPostSources,
  findingPosts: postgresFindingPosts,
};
