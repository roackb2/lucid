import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const lucidAgents = pgTable('lucid_agents', {
  id: text('id').primaryKey(),
  role: text('role').notNull(),
  task: text('task').notNull(),
  heartbeatTaskId: text('heartbeat_task_id').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});
