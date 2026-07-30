import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import { and, asc, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import type { LucidDatabaseService } from '../database/service.js';
import { dreamers, worldEvents, worldStates } from '../database/schema.js';
import { DEFAULT_DREAMERS } from './default-dreamers.js';
import {
  dreamerStatusSchema,
  worldEventKindSchema,
  type Dreamer,
  type DreamerView,
  type WakeContext,
  type WorldEvent,
  type WorldEventKind,
  type WorldEventMetadata,
  type WorldState,
} from './types.js';

const WORLD_ID = 'dream-terrarium';
const SNAPSHOT_EVENT_LIMIT = 180;

type DreamerRow = typeof dreamers.$inferSelect;
type WorldEventRow = typeof worldEvents.$inferSelect;
type WorldStateRow = typeof worldStates.$inferSelect;

export type AppendWorldEventInput = {
  tick?: number;
  kind: WorldEventKind;
  actorDreamerId?: string;
  targetDreamerId?: string;
  parentSequence?: number;
  title: string;
  content: string;
  metadata?: WorldEventMetadata;
};

export type TerrariumRepositorySnapshot = {
  world: WorldState;
  dreamers: DreamerView[];
  events: WorldEvent[];
};

/**
 * Owns Lucid's durable world model: Dreamer identity, event visibility,
 * round-robin wake selection, and event cursors. Heddle conversation state is
 * deliberately not stored or interpreted here.
 */
export class TerrariumRepository {
  constructor(private readonly database: LucidDatabaseService) {}

  initialize(): void {
    const world = this.findWorldState();
    if (world) {
      this.recoverInterruptedWakes(world);
      return;
    }

    this.createFreshWorld();
  }

  reset(): void {
    this.database.client.transaction(() => {
      this.database.orm.delete(worldStates).run();
      this.database.client
        .prepare("DELETE FROM sqlite_sequence WHERE name = 'world_events'")
        .run();
      this.insertFreshWorld();
    })();
  }

  readSnapshot(): TerrariumRepositorySnapshot {
    const world = this.requireWorldState();
    const allDreamers = this.listDreamers();
    const latestEvents = this.database.orm
      .select()
      .from(worldEvents)
      .where(eq(worldEvents.worldId, WORLD_ID))
      .orderBy(desc(worldEvents.sequence))
      .limit(SNAPSHOT_EVENT_LIMIT)
      .all()
      .reverse()
      .map(toWorldEvent);

    return {
      world,
      dreamers: allDreamers.map((dreamer) => ({
        id: dreamer.id,
        worldId: dreamer.worldId,
        sortOrder: dreamer.sortOrder,
        name: dreamer.name,
        archetype: dreamer.archetype,
        sigil: dreamer.sigil,
        color: dreamer.color,
        purpose: dreamer.purpose,
        status: dreamer.status,
        wakeCount: dreamer.wakeCount,
        lastAwakeAt: dreamer.lastAwakeAt,
        createdAt: dreamer.createdAt,
        updatedAt: dreamer.updatedAt,
        unreadCount: this.listVisibleEvents(dreamer.id, dreamer.lastSeenSequence, 10_000).length,
      })),
      events: latestEvents,
    };
  }

  listDreamers(): Dreamer[] {
    return this.database.orm
      .select()
      .from(dreamers)
      .where(eq(dreamers.worldId, WORLD_ID))
      .orderBy(asc(dreamers.sortOrder))
      .all()
      .map(toDreamer);
  }

  requireDreamer(id: string): Dreamer {
    const row = this.database.orm
      .select()
      .from(dreamers)
      .where(and(eq(dreamers.worldId, WORLD_ID), eq(dreamers.id, id)))
      .get();
    if (!row) {
      throw new Error(`Dreamer not found: ${id}`);
    }
    return toDreamer(row);
  }

  listVisibleEvents(dreamerId: string, afterSequence: number, limit = 40): WorldEvent[] {
    return this.database.orm
      .select()
      .from(worldEvents)
      .where(and(
        eq(worldEvents.worldId, WORLD_ID),
        gt(worldEvents.sequence, afterSequence),
        or(
          inArray(worldEvents.kind, ['origin', 'seed']),
          and(
            eq(worldEvents.kind, 'post'),
            or(
              isNull(worldEvents.actorDreamerId),
              ne(worldEvents.actorDreamerId, dreamerId),
            ),
          ),
          and(
            eq(worldEvents.kind, 'message'),
            eq(worldEvents.targetDreamerId, dreamerId),
          ),
        ),
      ))
      .orderBy(asc(worldEvents.sequence))
      .limit(limit)
      .all()
      .map(toWorldEvent);
  }

  readVisibleEventsBySequence(dreamerId: string, sequences: number[]): WorldEvent[] {
    if (!sequences.length) {
      return [];
    }

    return this.database.orm
      .select()
      .from(worldEvents)
      .where(and(
        eq(worldEvents.worldId, WORLD_ID),
        inArray(worldEvents.sequence, sequences),
        or(
          inArray(worldEvents.kind, ['origin', 'seed']),
          eq(worldEvents.kind, 'post'),
          and(
            eq(worldEvents.kind, 'message'),
            eq(worldEvents.targetDreamerId, dreamerId),
          ),
        ),
      ))
      .orderBy(asc(worldEvents.sequence))
      .all()
      .map(toWorldEvent);
  }

  seedWorld(content: string): WorldEvent {
    return this.appendEvent({
      kind: 'seed',
      title: 'A whisper entered the glass',
      content,
      metadata: { source: 'operator' },
    });
  }

  beginWake(): WakeContext {
    const world = this.requireWorldState();
    const allDreamers = this.listDreamers();
    if (!allDreamers.length) {
      throw new Error('The terrarium has no Dreamers.');
    }

    const dreamerIndex = world.nextDreamerIndex % allDreamers.length;
    const selectedDreamer = allDreamers[dreamerIndex];
    if (!selectedDreamer) {
      throw new Error(`Dreamer index ${dreamerIndex} could not be resolved.`);
    }

    const visibleEvents = this.listVisibleEvents(
      selectedDreamer.id,
      selectedDreamer.lastSeenSequence,
    );
    const horizonSequence = visibleEvents.at(-1)?.sequence ?? selectedDreamer.lastSeenSequence;
    const tick = world.currentTick + 1;
    const now = dayjs().toISOString();

    this.database.orm.transaction((transaction) => {
      transaction
        .update(worldStates)
        .set({
          currentTick: tick,
          nextDreamerIndex: (dreamerIndex + 1) % allDreamers.length,
          updatedAt: now,
        })
        .where(eq(worldStates.id, WORLD_ID))
        .run();
      transaction
        .update(dreamers)
        .set({
          status: 'waking',
          wakeCount: selectedDreamer.wakeCount + 1,
          lastAwakeAt: now,
          updatedAt: now,
        })
        .where(eq(dreamers.id, selectedDreamer.id))
        .run();
      transaction
        .insert(worldEvents)
        .values({
          id: `event_${randomUUID()}`,
          worldId: WORLD_ID,
          tick,
          kind: 'wake',
          actorDreamerId: selectedDreamer.id,
          title: `${selectedDreamer.name} wakes`,
          content: visibleEvents.length
            ? `${visibleEvents.length} unread world ${visibleEvents.length === 1 ? 'event waits' : 'events wait'} at the edge of consciousness.`
            : 'The world is quiet; only memory and curiosity remain.',
          metadata: {
            visibleEventSequences: visibleEvents.map((event) => event.sequence),
            horizonSequence,
          },
          createdAt: now,
        })
        .run();
    });

    return {
      dreamer: {
        ...selectedDreamer,
        status: 'waking',
        wakeCount: selectedDreamer.wakeCount + 1,
        lastAwakeAt: now,
        updatedAt: now,
      },
      tick,
      visibleEvents,
      horizonSequence,
    };
  }

  completeWake(dreamerId: string, horizonSequence: number): void {
    const dreamer = this.requireDreamer(dreamerId);
    const now = dayjs().toISOString();
    this.database.orm
      .update(dreamers)
      .set({
        status: 'resting',
        lastSeenSequence: Math.max(dreamer.lastSeenSequence, horizonSequence),
        updatedAt: now,
      })
      .where(eq(dreamers.id, dreamerId))
      .run();
  }

  failWake(dreamerId: string): void {
    this.database.orm
      .update(dreamers)
      .set({
        status: 'error',
        updatedAt: dayjs().toISOString(),
      })
      .where(eq(dreamers.id, dreamerId))
      .run();
  }

  interruptWake(dreamerId: string): void {
    this.database.orm
      .update(dreamers)
      .set({
        status: 'resting',
        updatedAt: dayjs().toISOString(),
      })
      .where(eq(dreamers.id, dreamerId))
      .run();
  }

  appendEvent(input: AppendWorldEventInput): WorldEvent {
    const world = this.requireWorldState();
    const row = this.database.orm
      .insert(worldEvents)
      .values({
        id: `event_${randomUUID()}`,
        worldId: WORLD_ID,
        tick: input.tick ?? world.currentTick,
        kind: input.kind,
        actorDreamerId: input.actorDreamerId,
        targetDreamerId: input.targetDreamerId,
        parentSequence: input.parentSequence,
        title: input.title,
        content: input.content,
        metadata: input.metadata ?? {},
        createdAt: dayjs().toISOString(),
      })
      .returning()
      .get();

    return toWorldEvent(row);
  }

  private findWorldState(): WorldState | undefined {
    const row = this.database.orm
      .select()
      .from(worldStates)
      .where(eq(worldStates.id, WORLD_ID))
      .get();
    return row ? toWorldState(row) : undefined;
  }

  private requireWorldState(): WorldState {
    const world = this.findWorldState();
    if (!world) {
      throw new Error('Dream Terrarium state is missing. Run database migration and initialize the service.');
    }
    return world;
  }

  private createFreshWorld(): void {
    this.database.client.transaction(() => {
      this.insertFreshWorld();
    })();
  }

  private insertFreshWorld(): void {
    const now = dayjs().toISOString();
    const generation = randomUUID();

    this.database.orm.insert(worldStates).values({
        id: WORLD_ID,
        generation,
        currentTick: 0,
        nextDreamerIndex: 0,
        createdAt: now,
        updatedAt: now,
      }).run();
    this.database.orm.insert(dreamers).values(DEFAULT_DREAMERS.map((dreamer) => ({
        ...dreamer,
        worldId: WORLD_ID,
        conversationId: `dreamer_${dreamer.id}_${generation}`,
        status: 'resting',
        wakeCount: 0,
        lastSeenSequence: 0,
        createdAt: now,
        updatedAt: now,
      }))).run();
    this.database.orm.insert(worldEvents).values({
        id: `event_${randomUUID()}`,
        worldId: WORLD_ID,
        tick: 0,
        kind: 'origin',
        title: 'The glass begins to breathe',
        content:
          'Three Dreamers wake beneath the glass. Lumen keeps provenance, Morrow transforms patterns into stories, and Sable tests every claim. None of them knows why the terrarium was built.',
        metadata: {
          generation,
          source: 'world',
        },
        createdAt: now,
      }).run();
  }

  private recoverInterruptedWakes(world: WorldState): void {
    const interrupted = this.database.orm
      .select()
      .from(dreamers)
      .where(and(
        eq(dreamers.worldId, WORLD_ID),
        eq(dreamers.status, 'waking'),
      ))
      .all();
    if (!interrupted.length) {
      return;
    }

    const now = dayjs().toISOString();
    this.database.orm.transaction((transaction) => {
      transaction
        .update(dreamers)
        .set({ status: 'resting', updatedAt: now })
        .where(and(
          eq(dreamers.worldId, WORLD_ID),
          eq(dreamers.status, 'waking'),
        ))
        .run();
      transaction.insert(worldEvents).values({
        id: `event_${randomUUID()}`,
        worldId: WORLD_ID,
        tick: world.currentTick,
        kind: 'error',
        title: 'Interrupted wakes returned to rest',
        content:
          `${interrupted.map((dreamer) => dreamer.name).join(', ')} ${
            interrupted.length === 1 ? 'was' : 'were'
          } waking when the host stopped. No unread world events were consumed.`,
        metadata: {
          recoveredDreamerIds: interrupted.map((dreamer) => dreamer.id),
        },
        createdAt: now,
      }).run();
    });
  }
}

function toDreamer(row: DreamerRow): Dreamer {
  return {
    ...row,
    status: dreamerStatusSchema.parse(row.status),
    lastAwakeAt: row.lastAwakeAt ?? undefined,
  };
}

function toWorldEvent(row: WorldEventRow): WorldEvent {
  return {
    ...row,
    kind: worldEventKindSchema.parse(row.kind),
    actorDreamerId: row.actorDreamerId ?? undefined,
    targetDreamerId: row.targetDreamerId ?? undefined,
    parentSequence: row.parentSequence ?? undefined,
    metadata: row.metadata ?? {},
  };
}

function toWorldState(row: WorldStateRow): WorldState {
  return { ...row };
}
