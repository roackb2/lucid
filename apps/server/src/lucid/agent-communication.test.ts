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
import { AgentCommunicationToolService } from './agent-communication-tools.js';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from './default-participants.js';
import {
  buildAgentWakePrompt,
  buildHeddleToolPolicyInstructions,
  buildRepresentativeAgentInstructions,
} from './agent-prompts.js';

const MIGRATIONS_ROOT = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

describe('representative-agent communication', () => {
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

  it('declares host-owned effects and the exact Heddle write root', async () => {
    const tools = await createUserTools(repository, 'wake_policy', 1);
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const workspaceRoot = '/tmp/lucid-tool-policy-test';

    expect(
      toolsByName.get('read_available_messages')?.hostPolicy,
    ).toMatchObject({
      authority: {
        kind: 'host-tool',
        id: 'lucid:discovery-events',
      },
      transport: {
        kind: 'in-process',
        network: false,
      },
      environment: 'local',
      operations: ['read'],
    });
    expect(toolsByName.get('post_shared_message')?.hostPolicy).toMatchObject({
      operations: ['write'],
    });
    expect(buildHeddleToolPolicyInstructions(workspaceRoot)).toContain(
      `targetRoots as ["${workspaceRoot}"]`,
    );
  });

  it('interpolates participant context and unread events into readable prompts', async () => {
    const agent = await repository.requireUserAgent();
    const participant = await repository.requireParticipant(LOCAL_USER_ID);
    const interest = await repository.saveInterest(
      'Find a concrete agent-native product experiment.',
    );

    expect(
      buildRepresentativeAgentInstructions(agent, participant),
    ).toContain(`You represent ${participant.displayName}.
You represent the real local user.
Their saved interest and feedback are private.`);
    expect(
      buildAgentWakePrompt(agent, participant, 1, [interest]),
    ).toContain(`Unread events visible to this agent:
- #${interest.sequence} [private user interest]`);
  });

  it('rejects invisible sources without spending the action budget', async () => {
    const hidden = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: 'sample-music-agent',
      targetAgentId: 'sample-product-agent',
      title: 'Hidden message',
      content: 'The user agent cannot cite this.',
    });
    const visible = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: 'sample-music-agent',
      targetAgentId: USER_AGENT_ID,
      title: 'Visible message',
      content: 'The user agent can cite this.',
    });
    const toolsByName = new Map(
      (await createUserTools(repository, 'wake_sources', 1))
        .map((tool) => [tool.name, tool]),
    );

    const rejected = await toolsByName.get('post_shared_message')!.execute({
      content: 'This hidden source should fail.',
      source_event_ids: [hidden.sequence],
    });
    const firstAction = await toolsByName.get('post_shared_message')!.execute({
      content: 'This visible source can be shared.',
      source_event_ids: [visible.sequence],
    });
    const secondAction = await toolsByName.get('send_direct_message')!.execute({
      target_agent_id: 'sample-product-agent',
      content: 'A second valid communication action.',
      source_event_ids: [visible.sequence],
    });
    const overBudget = await toolsByName.get('finish_without_action')!.execute({
      reason: 'This action should exceed the budget.',
    });

    expect(rejected.ok).toBe(false);
    expect(firstAction.ok).toBe(true);
    expect(secondAction.ok).toBe(true);
    expect(overBudget.ok).toBe(false);
  });

  it('keeps message reads and source references inside the claimed wake horizon', async () => {
    const claimedMessage = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: 'sample-music-agent',
      targetAgentId: USER_AGENT_ID,
      title: 'Message available when the wake was claimed',
      content: 'This message belongs to the current wake.',
    });
    const toolsByName = new Map(
      (await createUserTools(
        repository,
        'wake_fixed_horizon',
        1,
        claimedMessage.sequence,
      )).map((tool) => [tool.name, tool]),
    );
    const laterMessage = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: 'sample-product-agent',
      targetAgentId: USER_AGENT_ID,
      title: 'Message delivered during the model run',
      content: 'This message must remain unread until the next wake.',
    });

    const available = await toolsByName
      .get('read_available_messages')!
      .execute({ after_sequence: 0 });
    const rejected = await toolsByName.get('post_shared_message')!.execute({
      content: 'A post-claim event cannot affect the current wake.',
      source_event_ids: [laterMessage.sequence],
    });
    const accepted = await toolsByName.get('post_shared_message')!.execute({
      content: 'The claimed event remains a valid source.',
      source_event_ids: [claimedMessage.sequence],
    });

    expect(available).toMatchObject({
      ok: true,
      output: {
        events: [{ sequence: claimedMessage.sequence }],
      },
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: expect.stringContaining('after this wake was claimed'),
    });
    expect(accepted.ok).toBe(true);
  });

  it('reports only peer-sourced findings and prevents source reuse', async () => {
    const peerMessage = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: 'sample-music-agent',
      targetAgentId: USER_AGENT_ID,
      title: 'Specific participant response',
      content: 'A simulated participant has one relevant observation.',
    });
    const firstTools = new Map(
      (await createUserTools(repository, 'wake_finding_1', 1))
        .map((tool) => [tool.name, tool]),
    );
    const first = await firstTools.get('report_finding')!.execute({
      content: 'A simulated participant sent a specific match.',
      source_event_ids: [peerMessage.sequence],
    });
    const secondTools = new Map(
      (await createUserTools(repository, 'wake_finding_2', 2))
        .map((tool) => [tool.name, tool]),
    );
    const duplicate = await secondTools.get('report_finding')!.execute({
      content: 'The same source should not become a second finding.',
      source_event_ids: [peerMessage.sequence],
    });

    expect(first.ok).toBe(true);
    expect(duplicate.ok).toBe(false);
    expect((await repository.readSnapshot()).findings).toHaveLength(1);
  });

  it('allows one representative contribution per causal thread', async () => {
    const interest = await repository.saveInterest(
      'Start one bounded causal thread.',
    );
    const firstWake = new Map(
      (await createUserTools(repository, 'wake_thread_1', 1))
        .map((tool) => [tool.name, tool]),
    );
    const first = await firstWake.get('post_shared_message')!.execute({
      content: 'The first contribution is allowed.',
      source_event_ids: [interest.sequence],
    });

    const laterWake = new Map(
      (await createUserTools(repository, 'wake_thread_2', 2))
        .map((tool) => [tool.name, tool]),
    );
    const repeated = await laterWake.get('post_shared_message')!.execute({
      content: 'A later wake must not extend the same thread again.',
      source_event_ids: [interest.sequence],
    });
    const checkRequest = await repository.appendEvent({
      kind: 'check_requested',
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A new explicit check',
      content: 'This event starts a different causal thread.',
    });
    const newThread = await laterWake.get('post_shared_message')!.execute({
      content: 'A new user request allows a new contribution.',
      source_event_ids: [checkRequest.sequence],
    });

    expect(first.ok).toBe(true);
    expect(repeated.ok).toBe(false);
    expect(newThread.ok).toBe(true);
  });
});

async function createUserTools(
  repository: SqliteDiscoveryRepository,
  wakeId: string,
  wakeNumber: number,
  horizonSequence = Number.MAX_SAFE_INTEGER,
) {
  return await new AgentCommunicationToolService(
    repository,
    await repository.requireUserAgent(),
    await repository.requireParticipant(LOCAL_USER_ID),
    wakeId,
    wakeNumber,
    horizonSequence,
  ).definitions();
}
