import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { WorldEventMetadata } from '../terrarium/types.js';

export const worldStates = sqliteTable('world_states', {
  id: text('id').primaryKey(),
  generation: text('generation').notNull(),
  currentTick: integer('current_tick').notNull(),
  nextDreamerIndex: integer('next_dreamer_index').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const dreamers = sqliteTable('dreamers', {
  id: text('id').primaryKey(),
  worldId: text('world_id')
    .notNull()
    .references(() => worldStates.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  name: text('name').notNull(),
  archetype: text('archetype').notNull(),
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
  index('dreamers_world_sort_idx').on(table.worldId, table.sortOrder),
  uniqueIndex('dreamers_conversation_id_idx').on(table.conversationId),
]);

export const worldEvents = sqliteTable('world_events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  id: text('id').notNull(),
  worldId: text('world_id')
    .notNull()
    .references(() => worldStates.id, { onDelete: 'cascade' }),
  tick: integer('tick').notNull(),
  kind: text('kind').notNull(),
  actorDreamerId: text('actor_dreamer_id'),
  targetDreamerId: text('target_dreamer_id'),
  parentSequence: integer('parent_sequence'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<WorldEventMetadata>().notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('world_events_id_idx').on(table.id),
  index('world_events_world_sequence_idx').on(table.worldId, table.sequence),
  index('world_events_actor_idx').on(table.actorDreamerId, table.sequence),
  index('world_events_target_idx').on(table.targetDreamerId, table.sequence),
]);
