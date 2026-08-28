/**
 * Keeps the shared Heddle namespace in Lucid's Drizzle schema snapshot.
 *
 * Lucid no longer owns heartbeat tables, while its hosted conversation
 * lifecycle still lives in this schema through its dedicated migration.
 */
import { pgSchema } from 'drizzle-orm/pg-core';

export const heddleSchema = pgSchema('heddle');
