import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { SqliteDiscoveryRepository } from '../database/sqlite-discovery-repository.js';
import { LucidSqliteDatabase } from '../database/sqlite-database.js';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from './default-participants.js';

const MIGRATIONS_ROOT = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

describe('SQLite discovery repository', () => {
  let database: LucidSqliteDatabase;
  let repository: SqliteDiscoveryRepository;

  beforeEach(async () => {
    database = new LucidSqliteDatabase(':memory:');
    database.migrate(MIGRATIONS_ROOT);
    repository = new SqliteDiscoveryRepository(database);
    await repository.initialize();
  });

  afterEach(() => {
    database.close();
  });

  it('creates one real participant without exposing simulated private context', async () => {
    const snapshot = await repository.readSnapshot();

    expect(snapshot.workspace.currentWake).toBe(0);
    expect(snapshot.user).toMatchObject({
      id: LOCAL_USER_ID,
      kind: 'human',
      displayName: 'You',
    });
    expect(snapshot.agents.map((agent) => agent.name)).toEqual([
      'Lucid',
      'Music maker agent',
      'Product research agent',
    ]);
    expect(snapshot.agents.map((agent) => agent.participant.kind)).toEqual([
      'human',
      'synthetic',
      'synthetic',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain(
      'discarded intermediate versions',
    );
  });

  it('delivers user input only to the user representative', async () => {
    const interest = await repository.saveInterest(
      'Notice product ideas that require agents to represent different people.',
    );

    expect(
      (await repository
        .listEventsVisibleToAgent(USER_AGENT_ID, 0))
        .map((event) => event.sequence),
    ).toContain(interest.sequence);
    expect(
      (await repository
        .listEventsVisibleToAgent('sample-music-agent', 0))
        .map((event) => event.sequence),
    ).not.toContain(interest.sequence);
  });

  it('reuses a failed wake horizon and idempotency slots on retry', async () => {
    await repository.saveInterest('Find one specific participant match.');
    const firstWake = await repository.beginAgentWake(
      USER_AGENT_ID,
      'wake_first',
    );
    expect(firstWake).toBeDefined();

    const firstEvent = await repository.appendEvent({
      wakeNumber: firstWake!.wakeNumber,
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      idempotencyKey: `${firstWake!.wakeId}:action:1`,
      title: 'Original action',
      content: 'This is the first durable side effect.',
    });
    await repository.failAgentWake(USER_AGENT_ID);

    const retriedWake = await repository.beginAgentWake(
      USER_AGENT_ID,
      'wake_replacement',
    );
    expect(retriedWake).toMatchObject({
      wakeId: firstWake!.wakeId,
      wakeNumber: firstWake!.wakeNumber,
      horizonSequence: firstWake!.horizonSequence,
    });

    const retriedEvent = await repository.appendEvent({
      wakeNumber: retriedWake!.wakeNumber,
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      idempotencyKey: `${retriedWake!.wakeId}:action:1`,
      title: 'Replacement action',
      content: 'This must not create a second side effect.',
    });

    expect(retriedEvent).toEqual(firstEvent);
    expect(
      (await repository.readSnapshot()).events.filter(
        (event) => event.kind === 'shared_message',
      ),
    ).toHaveLength(1);
  });

  it('recovers an interrupted wake without consuming unread input', async () => {
    const interest = await repository.saveInterest(
      'Keep this input unread until the wake succeeds.',
    );
    const claimed = await repository.beginAgentWake(
      USER_AGENT_ID,
      'wake_before_restart',
    );
    expect(claimed?.visibleEvents.map((event) => event.sequence)).toContain(
      interest.sequence,
    );

    await repository.initialize();
    expect((await repository.requireUserAgent()).status).toBe('idle');

    const resumed = await repository.beginAgentWake(
      USER_AGENT_ID,
      'wake_after_restart',
    );
    expect(resumed).toMatchObject({
      wakeId: claimed!.wakeId,
      wakeNumber: claimed!.wakeNumber,
      horizonSequence: claimed!.horizonSequence,
    });
    expect(resumed?.visibleEvents.map((event) => event.sequence)).toContain(
      interest.sequence,
    );
    expect((await repository.readSnapshot()).events).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        title: 'Interrupted agent wakes recovered',
      }),
    );
  });
});
