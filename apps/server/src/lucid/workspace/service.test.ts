import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import type { PostgresLucidRepository } from '../persistence/postgres/repository.js';
import { createPostgresTestRepository } from '../persistence/postgres/test-context.js';
import { LOCAL_USER_ID, USER_AGENT_ID } from '../local-participant.js';
import { DiscoveryWorkspaceService } from './service.js';
import type {
  RepresentativeAgentHeartbeatService,
} from '../representative/heartbeat-service.js';

describe('discovery workspace service', () => {
  let database: PostgresDatabase;
  let repository: PostgresLucidRepository;

  beforeAll(async () => {
    ({ database, repository } = await createPostgresTestRepository({
      applicationName: 'lucid-discovery-workspace-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await repository.reset({ backgroundChecksEnabled: true });
  });

  afterAll(async () => database.close());

  it('uses the latest direct guidance in a manual check and triggers both wakes', async () => {
    const triggerAgent = vi.fn(async () => undefined);
    const heartbeats = {
      snapshotForAgent: async () => ({
        enabled: true,
        dispatchEnabled: true,
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
    const priorNote = await repository.appendEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Look for named support handoffs and recovery behavior.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });
    const guidanceSnapshot = await workspace.submitGuidance(
      'Weak signals are useful again, but label them clearly.',
    );
    const guidance = guidanceSnapshot.guidanceFollowThrough?.guidance;
    expect(guidance).toBeDefined();
    const note = await repository.appendEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content:
        'Accept clearly labeled weak signals; do not require the exact mechanism.',
      metadata: { throughSequence: guidance!.sequence, derived: true },
    });

    await workspace.runNow();

    const check = (await repository.readNetworkDiagnostics()).events
      .findLast(({ kind }) => kind === 'check_requested');
    expect(check).toMatchObject({
      targetAgentId: USER_AGENT_ID,
      metadata: {
        interestSequence: interest.sequence,
        workingNoteSequence: note.sequence,
        latestGuidanceSequence: guidance!.sequence,
      },
    });
    expect(check?.content).toContain(interest.content);
    expect(check?.content).toContain(note.content);
    expect(check?.content).toContain(guidance!.content);
    expect(check?.content).not.toContain(feedback.content);
    expect(check?.content).toContain(
      'do not send only another paraphrase of the original broad assignment',
    );
    expect(check!.content.indexOf(note.content))
      .toBeLessThan(check!.content.indexOf(interest.content));
    expect(check!.content.indexOf(guidance!.content))
      .toBeLessThan(check!.content.indexOf(interest.content));
    expect(priorNote.content).not.toBe(note.content);
    expect(triggerAgent).toHaveBeenCalledTimes(2);
    expect(triggerAgent).toHaveBeenNthCalledWith(1, USER_AGENT_ID);
    expect(triggerAgent).toHaveBeenNthCalledWith(2, USER_AGENT_ID);
  });
});
