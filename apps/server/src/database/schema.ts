import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { NetworkEventMetadata } from '../lucid/types.js';

export const networkStates = sqliteTable('network_states', {
  id: text('id').primaryKey(),
  generation: text('generation').notNull(),
  currentTick: integer('current_tick').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const principals = sqliteTable('principals', {
  id: text('id').primaryKey(),
  networkId: text('network_id')
    .notNull()
    .references(() => networkStates.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  displayName: text('display_name').notNull(),
  privateContext: text('private_context').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('principals_network_idx').on(table.networkId),
]);

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  networkId: text('network_id')
    .notNull()
    .references(() => networkStates.id, { onDelete: 'cascade' }),
  principalId: text('principal_id')
    .notNull()
    .references(() => principals.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  sigil: text('sigil').notNull(),
  color: text('color').notNull(),
  purpose: text('purpose').notNull(),
  persona: text('persona').notNull(),
  conversationId: text('conversation_id').notNull(),
  status: text('status').notNull(),
  wakeCount: integer('wake_count').notNull(),
  lastSeenSequence: integer('last_seen_sequence').notNull(),
  lastAwakeAt: text('last_awake_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('agents_network_sort_idx').on(table.networkId, table.sortOrder),
  uniqueIndex('agents_principal_id_idx').on(table.principalId),
  uniqueIndex('agents_conversation_id_idx').on(table.conversationId),
]);

export const networkEvents = sqliteTable('network_events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  id: text('id').notNull(),
  networkId: text('network_id')
    .notNull()
    .references(() => networkStates.id, { onDelete: 'cascade' }),
  tick: integer('tick').notNull(),
  kind: text('kind').notNull(),
  actorAgentId: text('actor_agent_id'),
  targetAgentId: text('target_agent_id'),
  targetPrincipalId: text('target_principal_id'),
  parentSequence: integer('parent_sequence'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<NetworkEventMetadata>().notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('network_events_id_idx').on(table.id),
  index('network_events_network_sequence_idx').on(table.networkId, table.sequence),
  index('network_events_actor_idx').on(table.actorAgentId, table.sequence),
  index('network_events_target_agent_idx').on(table.targetAgentId, table.sequence),
  index('network_events_target_principal_idx').on(table.targetPrincipalId, table.sequence),
]);
