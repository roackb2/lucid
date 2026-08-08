/**
 * PostgreSQL persistence model for Lucid's shared hosted workspace.
 *
 * The `lucid` schema contains product-owned participant, representative, and
 * immutable event state. Heddle heartbeat state belongs to a separate
 * `heddle` schema and will be introduced only against Heddle's released remote
 * store contract; this module deliberately does not copy Heddle internals.
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
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { DiscoveryEventMetadata } from '../lucid/discovery-types.js';

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
      .default(true),
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

export const postgresParticipants = lucidPostgresSchema.table(
  'participants',
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
    index('participants_workspace_idx').on(table.workspaceId),
    uniqueIndex('participants_registration_key_idx').on(table.registrationKey),
    check('participants_kind_valid', sql`${table.kind} in ('human', 'synthetic')`),
    check(
      'participants_status_valid',
      sql`${table.status} in ('active', 'disabled', 'retired')`,
    ),
    check(
      'participants_human_consent_required',
      sql`${table.kind} <> 'human' or ${table.contextConsentAt} is not null`,
    ),
  ],
);

export const postgresRepresentativeAgents = lucidPostgresSchema.table(
  'representative_agents',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => postgresDiscoveryWorkspaces.id, {
        onDelete: 'cascade',
      }),
    participantId: text('participant_id')
      .notNull()
      .references(() => postgresParticipants.id, { onDelete: 'cascade' }),
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
    index('representative_agents_workspace_sort_idx').on(
      table.workspaceId,
      table.sortOrder,
    ),
    uniqueIndex('representative_agents_participant_idx')
      .on(table.participantId),
    check(
      'representative_agents_status_valid',
      sql`${table.status} in ('idle', 'running', 'error')`,
    ),
    check(
      'representative_agents_counters_nonnegative',
      sql`${table.sortOrder} >= 0 and ${table.runCount} >= 0 and ${table.mailboxFloorSequence} >= 0 and ${table.lastSeenSequence} >= 0`,
    ),
    check(
      'representative_agents_wake_claim_complete',
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
    targetParticipantId: text('target_participant_id'),
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
    index('discovery_events_target_participant_idx').on(
      table.targetParticipantId,
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

export const lucidPostgresTables = {
  discoveryWorkspaces: postgresDiscoveryWorkspaces,
  participants: postgresParticipants,
  representativeAgents: postgresRepresentativeAgents,
  discoveryEvents: postgresDiscoveryEvents,
};
