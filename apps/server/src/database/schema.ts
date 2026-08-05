/**
 * Relational persistence model for one local Lucid discovery workspace.
 * Participants own private context, representatives own durable mailbox/wake
 * cursors, and immutable discovery events are the communication and audit log.
 * The schema records provenance and delivery state, not truth or value scores.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { DiscoveryEventMetadata } from '../lucid/discovery-types.js';

export const discoveryWorkspaces = sqliteTable('discovery_workspaces', {
  id: text('id').primaryKey(),
  versionId: text('version_id').notNull(),
  currentWake: integer('current_wake').notNull(),
  backgroundChecksEnabled: integer('background_checks_enabled', {
    mode: 'boolean',
  }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const participants = sqliteTable('participants', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => discoveryWorkspaces.id, { onDelete: 'cascade' }),
  registrationKey: text('registration_key'),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('active'),
  displayName: text('display_name').notNull(),
  privateContext: text('private_context').notNull(),
  contextConsentAt: text('context_consent_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('participants_workspace_idx').on(table.workspaceId),
  uniqueIndex('participants_registration_key_idx').on(table.registrationKey),
]);

export const representativeAgents = sqliteTable('representative_agents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => discoveryWorkspaces.id, { onDelete: 'cascade' }),
  participantId: text('participant_id')
    .notNull()
    .references(() => participants.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  color: text('color').notNull(),
  purpose: text('purpose').notNull(),
  instructions: text('instructions').notNull(),
  status: text('status').notNull(),
  runCount: integer('run_count').notNull(),
  mailboxFloorSequence: integer('mailbox_floor_sequence').notNull().default(0),
  lastSeenSequence: integer('last_seen_sequence').notNull(),
  activeWakeId: text('active_wake_id'),
  activeWakeNumber: integer('active_wake_number'),
  activeWakeHorizon: integer('active_wake_horizon'),
  lastRunAt: text('last_run_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('representative_agents_workspace_sort_idx').on(
    table.workspaceId,
    table.sortOrder,
  ),
  uniqueIndex('representative_agents_participant_idx').on(table.participantId),
]);

export const discoveryEvents = sqliteTable('discovery_events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  id: text('id').notNull(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => discoveryWorkspaces.id, { onDelete: 'cascade' }),
  wakeNumber: integer('wake_number').notNull(),
  kind: text('kind').notNull(),
  actorAgentId: text('actor_agent_id'),
  targetAgentId: text('target_agent_id'),
  targetParticipantId: text('target_participant_id'),
  parentSequence: integer('parent_sequence'),
  idempotencyKey: text('idempotency_key'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<DiscoveryEventMetadata>().notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
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
]);
