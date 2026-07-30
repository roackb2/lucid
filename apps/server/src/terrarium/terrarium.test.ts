import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { LucidDatabaseService } from '../database/service.js';
import { createLucidLogger } from '../logger.js';
import { TerrariumRepository } from './repository.js';
import { DreamTerrariumService } from './service.js';
import {
  type DreamerMind,
  type StartDreamerMindInput,
} from './types.js';
import { DreamerWorldToolService } from './world-tools.js';

const MIGRATIONS_ROOT = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe('Dream Terrarium', () => {
  let database: LucidDatabaseService;
  let repository: TerrariumRepository;

  beforeEach(() => {
    database = new LucidDatabaseService(':memory:');
    database.migrate(MIGRATIONS_ROOT);
    repository = new TerrariumRepository(database);
    repository.initialize();
  });

  afterEach(() => {
    database.close();
  });

  it('creates a fresh society and preserves private event visibility', () => {
    const snapshot = repository.readSnapshot();
    const [lumen, morrow, sable] = repository.listDreamers();

    expect(snapshot.world.currentTick).toBe(0);
    expect(snapshot.events.map((event) => event.kind)).toEqual(['origin']);
    expect(snapshot.dreamers.map((dreamer) => dreamer.name)).toEqual([
      'Lumen',
      'Morrow',
      'Sable',
    ]);
    expect(lumen && morrow && sable).toBeTruthy();

    const whisper = repository.appendEvent({
      kind: 'message',
      actorDreamerId: lumen!.id,
      targetDreamerId: morrow!.id,
      title: 'A private test',
      content: 'Only Morrow should receive this.',
    });

    expect(repository.listVisibleEvents(morrow!.id, 0).map((event) => event.sequence))
      .toContain(whisper.sequence);
    expect(repository.listVisibleEvents(sable!.id, 0).map((event) => event.sequence))
      .not.toContain(whisper.sequence);
    expect(repository.listVisibleEvents(lumen!.id, 0).map((event) => event.sequence))
      .not.toContain(whisper.sequence);
  });

  it('advances all three durable minds in round-robin order', async () => {
    const mind = new PostingMind(repository);
    const service = new DreamTerrariumService(
      repository,
      mind,
      { model: 'test-mind', heddleVersion: 'test' },
      createLucidLogger('silent'),
    );

    service.startCycle(3);
    await vi.waitFor(() => {
      expect(service.snapshot().activeCycle).toBeUndefined();
    });

    const snapshot = service.snapshot();
    expect(snapshot.world.currentTick).toBe(3);
    expect(snapshot.dreamers.map((dreamer) => dreamer.wakeCount)).toEqual([1, 1, 1]);
    expect(snapshot.dreamers.map((dreamer) => dreamer.status)).toEqual([
      'resting',
      'resting',
      'resting',
    ]);
    expect(mind.observations.map(({ dreamerId }) => dreamerId)).toEqual([
      'lumen',
      'morrow',
      'sable',
    ]);
    expect(mind.observations.map(({ visibleKinds }) => visibleKinds)).toEqual([
      ['origin'],
      ['origin', 'post'],
      ['origin', 'post', 'post'],
    ]);
  });

  it('does not spend mutation budget on a rejected invisible source', async () => {
    const [lumen, morrow, sable] = repository.listDreamers();
    const origin = repository.readSnapshot().events[0]!;
    const whisper = repository.appendEvent({
      kind: 'message',
      actorDreamerId: lumen!.id,
      targetDreamerId: morrow!.id,
      title: 'Hidden premise',
      content: 'Sable cannot cite this.',
    });
    const tools = new DreamerWorldToolService(repository, sable!, 1);
    const publish = tools
      .definitions()
      .find((tool) => tool.name === 'publish_to_world');

    expect(publish).toBeDefined();
    const rejected = await publish!.execute({
      content: 'I should not know this.',
      source_event_ids: [whisper.sequence],
    });
    const first = await publish!.execute({
      content: 'The origin is observable.',
      source_event_ids: [origin.sequence],
    });
    const firstPost = repository.readSnapshot().events.at(-1)!;
    const second = await publish!.execute({
      content: 'A second deliberate action.',
      source_event_ids: [firstPost.sequence],
    });
    const overBudget = await publish!.execute({
      content: 'This would be noise.',
      source_event_ids: [],
    });

    expect(rejected.ok).toBe(false);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(overBudget.ok).toBe(false);
  });

  it('recovers a Dreamer left waking by an interrupted host', () => {
    repository.beginWake();
    expect(repository.requireDreamer('lumen').status).toBe('waking');

    repository.initialize();

    expect(repository.requireDreamer('lumen').status).toBe('resting');
    expect(repository.readSnapshot().events.at(-1)).toMatchObject({
      kind: 'error',
      title: 'Interrupted wakes returned to rest',
    });
  });

  it('starts a reset generation with a clean causal sequence', () => {
    repository.seedWorld('An event in the old generation.');
    expect(repository.readSnapshot().events.at(-1)?.sequence).toBe(2);

    repository.reset();

    const snapshot = repository.readSnapshot();
    expect(snapshot.world.currentTick).toBe(0);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({
      sequence: 1,
      kind: 'origin',
    });
  });

  it('waits for an interrupted wake to return to rest before shutdown', async () => {
    const service = new DreamTerrariumService(
      repository,
      new InterruptibleMind(),
      { model: 'test-mind', heddleVersion: 'test' },
      createLucidLogger('silent'),
    );

    service.startCycle(1);
    await vi.waitFor(() => {
      expect(service.snapshot().activeCycle?.dreamerId).toBe('lumen');
    });
    await service.stop();

    const snapshot = service.snapshot();
    expect(snapshot.activeCycle).toBeUndefined();
    expect(snapshot.dreamers[0]?.status).toBe('resting');
    expect(snapshot.events.at(-1)).toMatchObject({
      kind: 'error',
      actorDreamerId: 'lumen',
      metadata: {
        cancelled: true,
      },
    });
  });
});

class PostingMind implements DreamerMind {
  readonly observations: Array<{
    dreamerId: string;
    visibleKinds: string[];
  }> = [];

  constructor(private readonly repository: TerrariumRepository) {}

  async start(input: StartDreamerMindInput) {
    this.observations.push({
      dreamerId: input.dreamer.id,
      visibleKinds: input.visibleEvents.map((event) => event.kind),
    });
    input.onActivity?.({
      type: 'test',
      summary: `${input.dreamer.name} is composing a test post.`,
      timestamp: dayjs().toISOString(),
    });
    this.repository.appendEvent({
      tick: input.tick,
      kind: 'post',
      actorDreamerId: input.dreamer.id,
      title: `${input.dreamer.name} posts`,
      content: `A deterministic thought from ${input.dreamer.name}.`,
    });

    return {
      runId: `run_${input.dreamer.id}`,
      result: Promise.resolve({
        outcome: 'done',
        summary: `${input.dreamer.name} completed the scripted wake.`,
        toolCount: 1,
      }),
      cancel: () => false,
    };
  }
}

class InterruptibleMind implements DreamerMind {
  async start(input: StartDreamerMindInput) {
    return {
      runId: 'run_interruptible',
      result: new Promise<never>((_resolve, reject) => {
        input.signal.addEventListener(
          'abort',
          () => reject(new Error('Test wake interrupted.')),
          { once: true },
        );
      }),
      cancel: () => true,
    };
  }
}
