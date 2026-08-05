import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { SqliteDiscoveryRepository } from '../database/sqlite-discovery-repository.js';
import { LucidSqliteDatabase } from '../database/sqlite-database.js';
import { LOCAL_USER_ID, USER_AGENT_ID } from './local-participant.js';
import { DiscoveryWorkspaceService } from './discovery-workspace-service.js';
import type {
  RepresentativeAgentHeartbeatService,
} from './representative-agent-heartbeat-service.js';

const MIGRATIONS_ROOT = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

describe('discovery workspace service', () => {
  let database: LucidSqliteDatabase;
  let repository: SqliteDiscoveryRepository;

  beforeEach(async () => {
    database = new LucidSqliteDatabase(':memory:');
    database.migrate(MIGRATIONS_ROOT);
    repository = new SqliteDiscoveryRepository(database);
    await repository.initialize();
  });

  afterEach(() => database.close());

  it('includes current learning in a manual check before triggering the representative', async () => {
    const triggerAgent = vi.fn(async () => undefined);
    const heartbeats = {
      snapshotForAgent: async () => ({
        enabled: true,
        running: false,
        intervalMs: 60_000,
        tasks: [{
          taskId: 'lucid-representative-user-agent',
          agentId: USER_AGENT_ID,
          enabled: true,
          status: 'waiting' as const,
          progress: 'Waiting for the next wake.',
          intervalMs: 60_000,
        }],
      }),
      triggerAgent,
    } as unknown as RepresentativeAgentHeartbeatService;
    const workspace = new DiscoveryWorkspaceService(
      repository,
      heartbeats,
      { model: 'test-model', heddleVersion: 'test' },
    );
    const interest = await repository.saveInterest(
      'Find useful long-running agent workflows.',
    );
    const source = await repository.registerParticipant({
      registrationKey: 'test:manual-check-source',
      kind: 'synthetic',
      displayName: 'Workflow operator',
      privateContext: 'Has experience with support workflows.',
    });
    const sourceMessage = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      title: 'An earlier network lead',
      content: 'A support operator keeps unresolved cases across daily wakes.',
    });
    const finding = await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A possible workflow',
      content: 'A support workflow may be relevant.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });
    const feedback = await repository.saveFeedback(
      LOCAL_USER_ID,
      finding.sequence,
      'Only continue when the lead names the actual handoff and recovery steps.',
    );
    const note = await repository.appendEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Look for named support handoffs and recovery behavior.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });

    await workspace.runNow();

    const check = (await repository.readNetworkDiagnostics()).events
      .findLast(({ kind }) => kind === 'check_requested');
    expect(check).toMatchObject({
      targetAgentId: USER_AGENT_ID,
      metadata: {
        interestSequence: interest.sequence,
        workingNoteSequence: note.sequence,
        latestFeedbackSequence: feedback.sequence,
      },
    });
    expect(check?.content).toContain(interest.content);
    expect(check?.content).toContain(note.content);
    expect(check?.content).toContain(feedback.content);
    expect(check?.content).toContain(
      'do not send only another paraphrase of the original broad assignment',
    );
    expect(check!.content.indexOf(note.content))
      .toBeLessThan(check!.content.indexOf(interest.content));
    expect(check!.content.indexOf(feedback.content))
      .toBeLessThan(check!.content.indexOf(interest.content));
    expect(triggerAgent).toHaveBeenCalledOnce();
    expect(triggerAgent).toHaveBeenCalledWith(USER_AGENT_ID);
  });
});
