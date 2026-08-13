/**
 * PostgreSQL persistence model for Lucid's shared hosted workspace.
 *
 * The `lucid` schema contains product-owned user, agent, and
 * immutable event state. The runtime heartbeat adapter owns the separate
 * `heddle` schema through Heddle's released remote-store contracts; this
 * module deliberately declares no Heddle internals.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { DiscoveryEventMetadata } from '../../discovery-types.js';
import type {
  HostedConversationErrorCode,
  HostedConversationTurnStatus,
} from '../../../hosted-execution/conversation/store.js';

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

/** Bounded user-visible projection of managed hosted conversation turns. */
export const postgresHostedConversationTurns = lucidPostgresSchema.table(
  'hosted_conversation_turns',
  {
    invocationId: text('invocation_id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => postgresDiscoveryWorkspaces.id, {
        onDelete: 'cascade',
      }),
    userId: text('user_id')
      .notNull()
      .references(() => postgresUsers.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    status: text('status')
      .$type<HostedConversationTurnStatus>()
      .notNull(),
    runId: text('run_id'),
    answerMarkdown: text('answer_markdown'),
    errorCode: text('error_code').$type<HostedConversationErrorCode>(),
    deadlineAt: timestampColumn('deadline_at').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    acceptedAt: timestampColumn('accepted_at'),
    settledAt: timestampColumn('settled_at'),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    index('hosted_conversation_turns_user_recent_idx').on(
      table.workspaceId,
      table.userId,
      table.createdAt,
    ),
    check(
      'hosted_conversation_turns_invocation_id_valid',
      sql`char_length(${table.invocationId}) between 1 and 256`,
    ),
    check(
      'hosted_conversation_turns_prompt_valid',
      sql`char_length(${table.prompt}) between 1 and 20000 and ${table.prompt} = btrim(${table.prompt})`,
    ),
    check(
      'hosted_conversation_turns_status_valid',
      sql`${table.status} in ('requested', 'running', 'completed', 'max_steps', 'failed', 'cancelled', 'interrupted')`,
    ),
    check(
      'hosted_conversation_turns_run_id_valid',
      sql`${table.runId} is null or char_length(${table.runId}) between 1 and 256`,
    ),
    check(
      'hosted_conversation_turns_answer_bounded',
      sql`${table.answerMarkdown} is null or char_length(${table.answerMarkdown}) <= 100000`,
    ),
    check(
      'hosted_conversation_turns_error_code_valid',
      sql`${table.errorCode} is null or ${table.errorCode} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
    ),
    check(
      'hosted_conversation_turns_lifecycle_valid',
      sql`(
        ${table.status} = 'requested'
        and ${table.runId} is null
        and ${table.acceptedAt} is null
        and ${table.settledAt} is null
      ) or (
        ${table.status} = 'running'
        and ${table.runId} is not null
        and ${table.acceptedAt} is not null
        and ${table.settledAt} is null
      ) or (
        ${table.status} in ('completed', 'max_steps', 'failed', 'cancelled', 'interrupted')
        and ${table.settledAt} is not null
      )`,
    ),
  ],
);

export const lucidPostgresTables = {
  discoveryWorkspaces: postgresDiscoveryWorkspaces,
  users: postgresUsers,
  userIdentityBindings: postgresUserIdentityBindings,
  agents: postgresAgents,
  discoveryEvents: postgresDiscoveryEvents,
  hostedConversationTurns: postgresHostedConversationTurns,
};
