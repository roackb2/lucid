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
} from './local-participant.js';
import {
  buildAgentWakePrompt,
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

  it('declares host-owned effects and domain write scope', async () => {
    const tools = await createUserTools(repository, 'wake_policy', 1);
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(toolsByName.get('read_available_messages')?.hostPolicy)
      .toMatchObject({
        authority: { kind: 'host-tool', id: 'lucid:discovery-events' },
        transport: { kind: 'in-process', network: false },
        environment: 'local',
        operations: ['read'],
      });
    expect(toolsByName.get('post_shared_message')?.hostPolicy).toMatchObject({
      operations: ['write'],
      writeScope: {
        kind: 'domain',
        resources: ['lucid:discovery-events'],
      },
    });
    expect(toolsByName.get('update_working_note')?.hostPolicy).toMatchObject({
      operations: ['write'],
      writeScope: {
        kind: 'domain',
        resources: ['lucid:discovery-events'],
      },
    });
  });

  it('interpolates generic participant context and private inputs into readable prompts', async () => {
    const source = await registerSynthetic(repository, 'prompt-source');
    const input = await repository.saveParticipantInput(
      source.participant.id,
      'A new observation belongs only to this principal.',
      'prompt-source:input:1',
    );

    expect(buildRepresentativeAgentInstructions(
      source.agent,
      source.participant,
    )).toContain(`You represent ${source.participant.displayName}.
You represent an explicitly simulated test participant, not a real person or external source.`);
    expect(buildAgentWakePrompt(
      source.agent,
      source.participant,
      1,
      [input],
      {
        principalInputs: [input],
        findings: [],
      },
    )).toContain(`Unread events visible to this agent:
- #${input.sequence} [private participant input]`);
  });

  it('places prior findings, feedback, and the working note before unread events', async () => {
    const source = await registerSynthetic(repository, 'prompt-history-source');
    const interest = await repository.saveInterest(
      'Find concrete examples of agents preserving unfinished work.',
    );
    const sourceMessage = await peerMessage(
      repository,
      source.agent.id,
      USER_AGENT_ID,
      'One team kept abandoned drafts to compare later decisions.',
    );
    const finding = await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'New finding for You',
      content: 'Abandoned drafts may preserve useful decision context.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });
    const feedback = await repository.saveFeedback(
      LOCAL_USER_ID,
      finding.sequence,
      'Only report this direction again with a named workflow.',
    );
    const note = await repository.appendEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a named workflow for future draft-retention findings.',
    });
    const laterMessage = await peerMessage(
      repository,
      source.agent.id,
      USER_AGENT_ID,
      'Another participant also keeps rough drafts.',
    );
    const context = await repository.readRepresentativeWorkingContext(
      USER_AGENT_ID,
      laterMessage.sequence,
    );
    const prompt = buildAgentWakePrompt(
      await repository.requireUserAgent(),
      await repository.requireParticipant(LOCAL_USER_ID),
      2,
      [laterMessage],
      context,
    );

    expect(prompt).toContain(`Current principal input:\n- #${interest.sequence}`);
    expect(prompt).toContain(`Private working note:\n#${note.sequence}: Require a named workflow`);
    expect(prompt).toContain(`Finding #${finding.sequence}: Abandoned drafts may preserve useful decision context.`);
    expect(prompt).toContain(`Participant feedback: #${feedback.sequence}: Only report this direction again with a named workflow.`);
    expect(prompt).toContain('A different source is not automatically a new finding');
    expect(prompt).toContain('Do not use report_finding as a reply.');
    expect(prompt).toContain('report_finding never replies to the source agent.');
    expect(prompt.indexOf('Ongoing assignment context:'))
      .toBeLessThan(prompt.indexOf('Unread events visible to this agent:'));
  });

  it('keeps reads and source references inside the claimed wake horizon', async () => {
    const source = await registerSynthetic(repository, 'horizon-source');
    const claimedMessage = await peerMessage(
      repository,
      source.agent.id,
      USER_AGENT_ID,
      'Message available when the wake was claimed.',
    );
    const tools = toolsByName(await createUserTools(
      repository,
      'wake_fixed_horizon',
      1,
      claimedMessage.sequence,
    ));
    const laterMessage = await peerMessage(
      repository,
      source.agent.id,
      USER_AGENT_ID,
      'Message delivered during the model run.',
    );

    expect(await tools.get('read_available_messages')!.execute({
      after_sequence: 0,
    })).toMatchObject({
      ok: true,
      output: { events: [{ sequence: claimedMessage.sequence }] },
    });
    expect(await tools.get('post_shared_message')!.execute({
      content: 'A post-claim event cannot affect this wake.',
      source_event_ids: [laterMessage.sequence],
    })).toMatchObject({
      ok: false,
      error: expect.stringContaining('after this wake was claimed'),
    });
    expect((await tools.get('post_shared_message')!.execute({
      content: 'The claimed event remains a valid source.',
      source_event_ids: [claimedMessage.sequence],
    })).ok).toBe(true);
  });

  it('does not let a representative cite its own shared message as inbox input', async () => {
    const ownMessage = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'The representative’s earlier message',
      content: 'This outbound event is not incoming mailbox evidence.',
    });
    const tools = toolsByName(await createUserTools(
      repository,
      'wake_own_source',
      1,
      ownMessage.sequence,
    ));

    expect(await tools.get('read_available_messages')!.execute({
      after_sequence: 0,
    })).toMatchObject({ ok: true, output: { events: [] } });
    expect((await tools.get('post_shared_message')!.execute({
      content: 'An own-authored event cannot be cited as visible input.',
      source_event_ids: [ownMessage.sequence],
    })).ok).toBe(false);
  });

  it('allows direct messages only to active peers encountered in visible events', async () => {
    const encountered = await registerSynthetic(repository, 'encountered');
    const unknown = await registerSynthetic(repository, 'unknown');
    const message = await peerMessage(
      repository,
      encountered.agent.id,
      USER_AGENT_ID,
      'This message introduces one peer to the local representative.',
    );
    const initialTools = await createUserTools(repository, 'wake_targets', 1);
    const targetSchema = initialTools.find(
      ({ name }) => name === 'send_direct_message',
    )?.parameters.properties?.target_agent_id;

    expect(targetSchema).toMatchObject({ enum: [encountered.agent.id] });
    expect(JSON.stringify(targetSchema)).not.toContain(unknown.agent.id);

    await repository.setParticipantStatus(
      encountered.participant.id,
      'disabled',
    );
    const disabledTools = toolsByName(await createUserTools(
      repository,
      'wake_disabled_target',
      2,
      message.sequence,
    ));
    expect(disabledTools.has('send_direct_message')).toBe(false);
  });

  it('does not spend the action budget when source validation rejects an action', async () => {
    const source = await registerSynthetic(repository, 'budget-source');
    const hidden = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: source.agent.id,
      title: 'Hidden message',
      content: 'The local representative cannot cite this.',
    });
    const visible = await peerMessage(
      repository,
      source.agent.id,
      USER_AGENT_ID,
      'The local representative can cite this.',
    );
    const tools = toolsByName(await createUserTools(
      repository,
      'wake_budget',
      1,
      visible.sequence,
    ));

    expect((await tools.get('update_working_note')!.execute({
      content: 'Remember the concrete visible source for later comparison.',
    })).ok).toBe(true);
    expect((await tools.get('update_working_note')!.execute({
      content: 'A second note replacement in one wake must fail.',
    })).ok).toBe(false);
    expect((await tools.get('post_shared_message')!.execute({
      content: 'This hidden source should fail.',
      source_event_ids: [hidden.sequence],
    })).ok).toBe(false);
    expect((await tools.get('post_shared_message')!.execute({
      content: 'This visible source is the first action.',
      source_event_ids: [visible.sequence],
    })).ok).toBe(true);
    expect((await tools.get('send_direct_message')!.execute({
      target_agent_id: source.agent.id,
      content: 'This direct response is the second action.',
      source_event_ids: [visible.sequence],
    })).ok).toBe(true);
    expect((await tools.get('finish_without_action')!.execute({
      reason: 'A third action exceeds the budget.',
    })).ok).toBe(false);
    expect((await repository.readSnapshot()).workingNote).toMatchObject({
      content: 'Remember the concrete visible source for later comparison.',
      metadata: expect.objectContaining({
        throughSequence: visible.sequence,
        derived: true,
      }),
    });
  });

  it('lets every representative report findings only to its own participant', async () => {
    const source = await registerSynthetic(repository, 'finding-owner');
    const request = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'Network request',
      content: 'Does anyone have a relevant observation?',
    });
    const tools = toolsByName(await new AgentCommunicationToolService(
      repository,
      source.agent,
      source.participant,
      'wake_source_finding',
      1,
      request.sequence,
    ).definitions());

    expect(tools.has('report_finding')).toBe(true);
    expect((await tools.get('report_finding')!.execute({
      content: 'The local participant asked about something relevant.',
      source_event_ids: [request.sequence],
    })).ok).toBe(true);
    expect((await repository.readNetworkDiagnostics()).events).toContainEqual(
      expect.objectContaining({
        kind: 'finding_reported',
        actorAgentId: source.agent.id,
        targetParticipantId: source.participant.id,
      }),
    );
    expect((await repository.readSnapshot()).findings).toEqual([]);
  });

  it('reports peer-sourced local findings once and preserves attribution', async () => {
    const source = await registerSynthetic(repository, 'local-finding-source');
    const message = await peerMessage(
      repository,
      source.agent.id,
      USER_AGENT_ID,
      'A participant supplied a specific observation.',
    );
    const first = toolsByName(await createUserTools(
      repository,
      'wake_finding_1',
      1,
      message.sequence,
    ));
    expect((await first.get('report_finding')!.execute({
      content: 'This observation may connect to your interest.',
      source_event_ids: [message.sequence],
    })).ok).toBe(true);

    const duplicate = toolsByName(await createUserTools(
      repository,
      'wake_finding_2',
      2,
      message.sequence,
    ));
    expect((await duplicate.get('report_finding')!.execute({
      content: 'The same source must not become another finding.',
      source_event_ids: [message.sequence],
    })).ok).toBe(false);
    expect((await repository.readSnapshot()).findings).toEqual([
      expect.objectContaining({
        finding: expect.objectContaining({ title: 'New finding for You' }),
        sources: [expect.objectContaining({
          attribution: expect.objectContaining({
            participantId: source.participant.id,
          }),
        })],
      }),
    ]);
  });

  it('allows one representative contribution per principal-initiated causal thread', async () => {
    const interest = await repository.saveInterest(
      'Start one bounded causal thread.',
    );
    const firstWake = toolsByName(await createUserTools(
      repository,
      'wake_thread_1',
      1,
      interest.sequence,
    ));
    expect((await firstWake.get('post_shared_message')!.execute({
      content: 'The first contribution is allowed.',
      source_event_ids: [interest.sequence],
    })).ok).toBe(true);

    const laterWake = toolsByName(await createUserTools(
      repository,
      'wake_thread_2',
      2,
      Number.MAX_SAFE_INTEGER,
    ));
    expect((await laterWake.get('post_shared_message')!.execute({
      content: 'A later wake cannot extend the same thread again.',
      source_event_ids: [interest.sequence],
    })).ok).toBe(false);
    const checkRequest = await repository.appendEvent({
      kind: 'check_requested',
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A new explicit check',
      content: 'This event starts a different causal thread.',
    });
    expect((await laterWake.get('post_shared_message')!.execute({
      content: 'A new request allows a new contribution.',
      source_event_ids: [checkRequest.sequence],
    })).ok).toBe(true);
  });
});

async function registerSynthetic(
  repository: SqliteDiscoveryRepository,
  key: string,
) {
  return await repository.registerParticipant({
    registrationKey: `sim:test:${key}`,
    kind: 'synthetic',
    displayName: `Synthetic ${key}`,
    privateContext: `Private context for ${key}.`,
  });
}

async function peerMessage(
  repository: SqliteDiscoveryRepository,
  actorAgentId: string,
  targetAgentId: string,
  content: string,
) {
  return await repository.appendEvent({
    kind: 'direct_message',
    actorAgentId,
    targetAgentId,
    title: 'Participant message',
    content,
  });
}

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

function toolsByName<T extends { name: string }>(tools: T[]): Map<string, T> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}
