import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { DiscoveryEventMetadata } from '../lucid/discovery-types.js';

export const discoveryWorkspaces = sqliteTable('discovery_workspaces', {
  id: text('id').primaryKey(),
  versionId: text('version_id').notNull(),
  currentStep: integer('current_step').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const participants = sqliteTable('participants', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => discoveryWorkspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  displayName: text('display_name').notNull(),
  privateContext: text('private_context').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('participants_workspace_idx').on(table.workspaceId),
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
  conversationId: text('conversation_id').notNull(),
  status: text('status').notNull(),
  runCount: integer('run_count').notNull(),
  lastSeenSequence: integer('last_seen_sequence').notNull(),
  lastRunAt: text('last_run_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('representative_agents_workspace_sort_idx').on(
    table.workspaceId,
    table.sortOrder,
  ),
  uniqueIndex('representative_agents_participant_idx').on(table.participantId),
  uniqueIndex('representative_agents_conversation_idx').on(table.conversationId),
]);

export const discoveryEvents = sqliteTable('discovery_events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  id: text('id').notNull(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => discoveryWorkspaces.id, { onDelete: 'cascade' }),
  stepNumber: integer('step_number').notNull(),
  kind: text('kind').notNull(),
  actorAgentId: text('actor_agent_id'),
  targetAgentId: text('target_agent_id'),
  targetParticipantId: text('target_participant_id'),
  parentSequence: integer('parent_sequence'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<DiscoveryEventMetadata>().notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('discovery_events_id_idx').on(table.id),
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
