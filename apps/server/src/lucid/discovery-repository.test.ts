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

  it('keeps assisted participant context private across its lifecycle', async () => {
    const historicalMessage = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'Message from before the participant joined',
      content: 'A new participant must not inherit this old message.',
    });
    const privateContext =
      'I enjoy small live jazz venues and avoid crowded festival settings.';
    const created = await repository.createAssistedParticipant({
      displayName: 'Avery',
      privateContext,
      contextApproved: true,
    });

    const createdSnapshot = await repository.readSnapshot();
    const participantView = createdSnapshot.agents.find(
      (agent) => agent.id === created.agent.id,
    )?.participant;
    expect(participantView).toMatchObject({
      id: created.participant.id,
      kind: 'human',
      status: 'active',
      displayName: 'Avery',
      contextConsentAt: expect.any(String),
    });
    expect(JSON.stringify(createdSnapshot)).not.toContain(privateContext);
    expect(
      await repository.listEventsVisibleToAgent(created.agent.id, 0),
    ).not.toContainEqual(
      expect.objectContaining({ sequence: historicalMessage.sequence }),
    );
    expect(
      await repository.readVisibleEventsBySequence(
        created.agent.id,
        [historicalMessage.sequence],
      ),
    ).toEqual([]);
    expect(createdSnapshot.events).toContainEqual(
      expect.objectContaining({
        kind: 'participant_added',
        content: expect.not.stringContaining(privateContext),
      }),
    );

    const revisedContext =
      'I now want my agent to notice small listening-room events and may share that preference when directly relevant.';
    const revised = await repository.updateAssistedParticipantContext({
      participantId: created.participant.id,
      privateContext: revisedContext,
      contextApproved: true,
    });
    expect(revised.participant).toMatchObject({
      privateContext: revisedContext,
      contextConsentAt: expect.any(String),
    });
    expect((await repository.requireParticipant(created.participant.id)))
      .toMatchObject({ privateContext: revisedContext });
    const revisedSnapshot = await repository.readSnapshot();
    expect(JSON.stringify(revisedSnapshot)).not.toContain(revisedContext);
    expect(revisedSnapshot.events).toContainEqual(expect.objectContaining({
      kind: 'participant_context_updated',
      targetParticipantId: created.participant.id,
      content: expect.not.stringContaining(revisedContext),
    }));

    await repository.setParticipantStatus(created.participant.id, 'disabled');
    const disabledPeriodMessage = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'Message sent while Avery is paused',
      content: 'This message should not be replayed after Avery returns.',
    });
    expect(
      await repository.listEventsVisibleToAgent(created.agent.id, 0),
    ).toEqual([]);
    expect(
      await repository.beginAgentWake(created.agent.id, 'disabled_wake'),
    ).toBeUndefined();

    await repository.setParticipantStatus(created.participant.id, 'active');
    expect(
      await repository.listEventsVisibleToAgent(created.agent.id, 0),
    ).not.toContainEqual(
      expect.objectContaining({ sequence: disabledPeriodMessage.sequence }),
    );
    expect(
      await repository.readVisibleEventsBySequence(
        created.agent.id,
        [disabledPeriodMessage.sequence],
      ),
    ).toEqual([]);
    const futureMessage = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'Message sent after Avery returns',
      content: 'This message should be delivered normally.',
    });
    expect(
      await repository.listEventsVisibleToAgent(
        created.agent.id,
        (await repository.requireAgent(created.agent.id)).lastSeenSequence,
      ),
    ).toContainEqual(expect.objectContaining({ sequence: futureMessage.sequence }));

    const retired = await repository.retireParticipant(created.participant.id);
    expect(retired.participant).toMatchObject({
      status: 'retired',
      privateContext: '',
    });
    expect((await repository.listActiveAgents()).map(({ id }) => id))
      .not.toContain(created.agent.id);
    const retiredSnapshot = await repository.readSnapshot();
    expect(retiredSnapshot.agents).toContainEqual(
      expect.objectContaining({
        id: created.agent.id,
        participant: expect.objectContaining({
          displayName: 'Avery',
          status: 'retired',
        }),
      }),
    );
    expect(JSON.stringify(retiredSnapshot)).not.toContain(privateContext);
    expect(JSON.stringify(retiredSnapshot)).not.toContain(revisedContext);
  });

  it('rejects context replacement for a simulated fixture', async () => {
    await expect(repository.updateAssistedParticipantContext({
      participantId: 'sample-music-maker',
      privateContext: 'Do not replace framework-owned fixture context.',
      contextApproved: true,
    })).rejects.toThrow(
      'Only an active or paused assisted participant can revise context.',
    );
  });

  it('preserves the no-match status of findings from earlier versions', async () => {
    const finding = await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'No relevant match found',
      content: 'The earlier check completed without a useful match.',
      metadata: {
        noMatch: true,
        sourceEventIds: [],
      },
    });

    expect((await repository.readSnapshot()).findings).toContainEqual(
      expect.objectContaining({
        finding: expect.objectContaining({ sequence: finding.sequence }),
        noMatch: true,
      }),
    );
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
