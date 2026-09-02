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
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../persistence/postgres/test-context.js';
import { LOCAL_USER_ID, LOCAL_AGENT_ID } from '../local-user.js';
import { DiscoveryWorkspaceService } from './service.js';
import type {
  AgentHeartbeatControl,
} from '../agent/heartbeat-control.js';
import {
  PostgresInformationNetworkFixtureSeeder,
} from '../information-network/fixtures.js';

describe('discovery workspace service', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-discovery-workspace-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: true });
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
          taskId: 'lucid-agent-user-agent',
          agentId: LOCAL_AGENT_ID,
          enabled: true,
          status: 'waiting' as const,
          progress: 'Waiting for the next wake.',
          intervalMs: 60_000,
        }],
      }),
      triggerAgent,
    } as unknown as AgentHeartbeatControl;
    const workspace = new DiscoveryWorkspaceService(
      stores.workspace,
      stores.informationNetwork,
      heartbeats,
      { model: 'test-model', heddleVersion: 'test' },
    );
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find useful long-running agent workflows.',
    );
    const source = await stores.network.registerUser({
      registrationKey: 'test:manual-check-source',
      kind: 'synthetic',
      displayName: 'Workflow operator',
      privateContext: 'Has experience with support workflows.',
    });
    const sourceMessage = await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: LOCAL_AGENT_ID,
      title: 'An earlier network lead',
      content: 'A support operator keeps unresolved cases across daily wakes.',
    });
    const finding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'A possible workflow',
      content: 'A support workflow may be relevant.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });
    const feedback = await stores.workspace.saveFeedback(
      LOCAL_USER_ID,
      finding.sequence,
      'Only continue when the lead names the actual handoff and recovery steps.',
    );
    const priorNote = await stores.communication.appendCommunicationEvent({
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Look for named support handoffs and recovery behavior.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });
    const guidanceSnapshot = await workspace.submitGuidance(
      LOCAL_USER_ID,
      'Weak signals are useful again, but label them clearly.',
    );
    const guidance = guidanceSnapshot.guidanceFollowThrough?.guidance;
    expect(guidance).toBeDefined();
    const note = await stores.communication.appendCommunicationEvent({
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content:
        'Accept clearly labeled weak signals; do not require the exact mechanism.',
      metadata: { throughSequence: guidance!.sequence, derived: true },
    });

    await workspace.runNow(LOCAL_USER_ID);

    const check = (await stores.network.readNetworkDiagnostics()).events
      .findLast(({ kind }) => kind === 'check_requested');
    expect(check).toMatchObject({
      targetAgentId: LOCAL_AGENT_ID,
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
    expect(triggerAgent).toHaveBeenNthCalledWith(1, LOCAL_AGENT_ID);
    expect(triggerAgent).toHaveBeenNthCalledWith(2, LOCAL_AGENT_ID);
  });

  it('projects navigable Network Posts onto only the owning user Finding', async () => {
    await new PostgresInformationNetworkFixtureSeeder(database).seed();
    const workspace = new DiscoveryWorkspaceService(
      stores.workspace,
      stores.informationNetwork,
      heartbeatStub(),
      { model: 'test-model', heddleVersion: 'test' },
    );

    const snapshot = await workspace.snapshot(LOCAL_USER_ID);
    const fixtureFinding = snapshot.findings.find(
      ({ finding }) => finding.id === 'fixture-finding-network-post',
    );

    expect(fixtureFinding?.networkPosts).toEqual([{
      id: 'repairability-as-design-language',
      title: 'Taipei labels are making repairability part of the silhouette',
      publishedAt: expect.any(String),
      publicationMethod: 'seeded-pilot',
      author: { id: 'mina-chen', displayName: 'Mina Chen' },
    }]);
    expect(JSON.stringify(snapshot)).not.toContain('privateContext');
    expect(JSON.stringify(snapshot)).not.toContain(
      'No model execution is authorized',
    );
  });
});

function heartbeatStub(): AgentHeartbeatControl {
  return {
    snapshotForAgent: async () => ({
      enabled: true,
      dispatchEnabled: true,
      running: false,
      intervalMs: 60_000,
      tasks: [],
    }),
  } as unknown as AgentHeartbeatControl;
}
