import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { PostgresDatabase } from '../../../infrastructure/postgres/database.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../../persistence/postgres/test-context.js';
import { AgentCommunicationToolService } from './tool-service.js';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from '../../local-participant.js';
import {
  buildAgentWakePrompt,
  buildRepresentativeAgentInstructions,
} from '../../agent-prompts.js';

describe('representative-agent communication', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-agent-communication-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.representative.reset({ backgroundChecksEnabled: true });
  });

  afterAll(async () => database.close());

  it('declares host-owned effects and domain write scope', async () => {
    const tools = await createUserTools(stores, 'wake_policy', 1);
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
    const source = await registerSynthetic(stores, 'prompt-source');
    const input = await stores.network.saveParticipantInput(
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
    const source = await registerSynthetic(stores, 'prompt-history-source');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find concrete examples of agents preserving unfinished work.',
    );
    const sourceMessage = await peerMessage(
      stores,
      source.agent.id,
      USER_AGENT_ID,
      'One team kept abandoned drafts to compare later decisions.',
    );
    const finding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'New finding for You',
      content: 'Abandoned drafts may preserve useful decision context.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });
    const feedback = await stores.workspace.saveFeedback(
      LOCAL_USER_ID,
      finding.sequence,
      'Only report this direction again with a named workflow.',
    );
    const note = await stores.communication.appendCommunicationEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a named workflow for future draft-retention findings.',
    });
    const laterMessage = await peerMessage(
      stores,
      source.agent.id,
      USER_AGENT_ID,
      'Another participant also keeps rough drafts.',
    );
    const context = await stores.workspace.readRepresentativeWorkingContext(
      USER_AGENT_ID,
      laterMessage.sequence,
    );
    const prompt = buildAgentWakePrompt(
      await stores.workspace.requireParticipantAgent(LOCAL_USER_ID),
      await requireLocalParticipant(stores),
      2,
      [laterMessage],
      context,
    );

    expect(prompt).toContain(`Current principal input:\n- #${interest.sequence}`);
    expect(prompt).toContain(`Private working note:\n#${note.sequence}: Require a named workflow`);
    expect(prompt).toContain(`Finding #${finding.sequence}: Abandoned drafts may preserve useful decision context.`);
    expect(prompt).toContain(`Participant feedback: #${feedback.sequence}: Only report this direction again with a named workflow.`);
    expect(prompt).toContain('A different source is not automatically a new finding');
    expect(prompt).toContain('Prioritize answering a matching peer request');
    expect(prompt).toContain('Never send a message merely to announce');
    expect(prompt).toContain('pending lead awaiting participant feedback');
    expect(prompt).toContain(
      'newest explicit participant guidance supersedes incompatible older assumptions',
    );
    expect(prompt).toContain(
      'a paraphrase of only the original broad assignment does not satisfy the check',
    );
    expect(prompt).toContain('Do not use report_finding as a reply.');
    expect(prompt).toContain('report_finding never replies to the source agent.');
    expect(prompt.indexOf('Ongoing assignment context:'))
      .toBeLessThan(prompt.indexOf('Unread events visible to this agent:'));
  });

  it('keeps reads and source references inside the claimed wake horizon', async () => {
    const source = await registerSynthetic(stores, 'horizon-source');
    const claimedMessage = await peerMessage(
      stores,
      source.agent.id,
      USER_AGENT_ID,
      'Message available when the wake was claimed.',
    );
    const tools = toolsByName(await createUserTools(
      stores,
      'wake_fixed_horizon',
      1,
      claimedMessage.sequence,
    ));
    const laterMessage = await peerMessage(
      stores,
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
      reply_to_event_id: laterMessage.sequence,
      content: 'A post-claim event cannot affect this wake.',
      source_event_ids: [laterMessage.sequence],
    })).toMatchObject({
      ok: false,
      error: expect.stringContaining('after this wake was claimed'),
    });
    expect((await tools.get('post_shared_message')!.execute({
      reply_to_event_id: claimedMessage.sequence,
      content: 'The claimed event remains a valid source.',
      source_event_ids: [claimedMessage.sequence],
    })).ok).toBe(true);
  });

  it('does not let a representative cite its own shared message as inbox input', async () => {
    const ownMessage = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'The representative’s earlier message',
      content: 'This outbound event is not incoming mailbox evidence.',
    });
    const tools = toolsByName(await createUserTools(
      stores,
      'wake_own_source',
      1,
      ownMessage.sequence,
    ));

    expect(await tools.get('read_available_messages')!.execute({
      after_sequence: 0,
    })).toMatchObject({ ok: true, output: { events: [] } });
    expect((await tools.get('post_shared_message')!.execute({
      reply_to_event_id: ownMessage.sequence,
      content: 'An own-authored event cannot be cited as visible input.',
      source_event_ids: [ownMessage.sequence],
    })).ok).toBe(false);
  });

  it('allows direct messages only to active peers encountered in visible events', async () => {
    const encountered = await registerSynthetic(stores, 'encountered');
    const unknown = await registerSynthetic(stores, 'unknown');
    const message = await peerMessage(
      stores,
      encountered.agent.id,
      USER_AGENT_ID,
      'This message introduces one peer to the local representative.',
    );
    const initialTools = await createUserTools(stores, 'wake_targets', 1);
    const targetSchema = initialTools.find(
      ({ name }) => name === 'send_direct_message',
    )?.parameters.properties?.target_agent_id;

    expect(targetSchema).toMatchObject({ enum: [encountered.agent.id] });
    expect(JSON.stringify(targetSchema)).not.toContain(unknown.agent.id);

    await stores.network.setParticipantStatus(
      encountered.participant.id,
      'disabled',
    );
    const disabledTools = toolsByName(await createUserTools(
      stores,
      'wake_disabled_target',
      2,
      message.sequence,
    ));
    expect(disabledTools.has('send_direct_message')).toBe(false);
  });

  it('does not spend the action budget when source validation rejects an action', async () => {
    const source = await registerSynthetic(stores, 'budget-source');
    const hidden = await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: source.agent.id,
      title: 'Hidden message',
      content: 'The local representative cannot cite this.',
    });
    const visible = await peerMessage(
      stores,
      source.agent.id,
      USER_AGENT_ID,
      'The local representative can cite this.',
    );
    const tools = toolsByName(await createUserTools(
      stores,
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
      reply_to_event_id: hidden.sequence,
      content: 'This hidden source should fail.',
      source_event_ids: [hidden.sequence],
    })).ok).toBe(false);
    expect((await tools.get('post_shared_message')!.execute({
      reply_to_event_id: visible.sequence,
      content: 'This visible source is the first action.',
      source_event_ids: [visible.sequence],
    })).ok).toBe(true);
    expect((await tools.get('send_direct_message')!.execute({
      target_agent_id: source.agent.id,
      reply_to_event_id: visible.sequence,
      content: 'This direct response is the second action.',
      source_event_ids: [visible.sequence],
    })).ok).toBe(true);
    expect((await tools.get('finish_without_action')!.execute({
      reason: 'A third action exceeds the budget.',
    })).ok).toBe(false);
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).workingNote).toMatchObject({
      content: 'Remember the concrete visible source for later comparison.',
      metadata: expect.objectContaining({
        throughSequence: visible.sequence,
        derived: true,
      }),
    });
  });

  it('requires the assignment request before any other communication action', async () => {
    const source = await registerSynthetic(stores, 'required-request');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find teams using representative agents for long-running discovery.',
    );
    const peer = await peerMessage(
      stores,
      source.agent.id,
      USER_AGENT_ID,
      'A team is testing persistent representatives for research handoffs.',
    );
    const tools = toolsByName(await createUserTools(
      stores,
      'wake_required_request',
      1,
      peer.sequence,
      [interest.sequence],
    ));

    expect(await tools.get('report_finding')!.execute({
      content: 'This peer message may be relevant.',
      source_event_ids: [peer.sequence],
    })).toMatchObject({
      ok: false,
      error: expect.stringContaining(`post_shared_message`),
    });
    expect((await tools.get('send_direct_message')!.execute({
      target_agent_id: source.agent.id,
      reply_to_event_id: peer.sequence,
      content: 'Reply before the required request.',
      source_event_ids: [peer.sequence],
    })).ok).toBe(false);
    expect((await tools.get('finish_without_action')!.execute({
      reason: 'Stop before the required request.',
    })).ok).toBe(false);
    expect((await tools.get('post_shared_message')!.execute({
      reply_to_event_id: peer.sequence,
      content: 'This cites only the peer and cannot satisfy the assignment.',
      source_event_ids: [peer.sequence],
    })).ok).toBe(false);

    expect((await tools.get('post_shared_message')!.execute({
      reply_to_event_id: interest.sequence,
      content: 'Looking for teams using persistent representative agents.',
      source_event_ids: [interest.sequence],
    })).ok).toBe(true);
    expect((await tools.get('report_finding')!.execute({
      content: 'A peer described a related research-handoff experiment.',
      source_event_ids: [peer.sequence],
    })).ok).toBe(true);
  });

  it('reuses a committed assignment request when the same wake retries', async () => {
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find concrete examples of durable representative-agent work.',
    );
    const firstTools = toolsByName(await createUserTools(
      stores,
      'wake_request_retry',
      4,
      interest.sequence,
      [interest.sequence],
    ));
    const firstResult = await firstTools.get('post_shared_message')!.execute({
      reply_to_event_id: interest.sequence,
      content: 'Looking for durable representative-agent work in practice.',
      source_event_ids: [interest.sequence],
    });
    expect(firstResult.ok).toBe(true);

    const retryTools = toolsByName(await createUserTools(
      stores,
      'wake_request_retry',
      4,
      interest.sequence,
      [interest.sequence],
    ));
    const retryResult = await retryTools.get('post_shared_message')!.execute({
      reply_to_event_id: interest.sequence,
      content: 'A retry regenerated this request with different wording.',
      source_event_ids: [interest.sequence],
    });

    expect(retryResult).toEqual(firstResult);
    expect(await stores.communication.countAgentWakeCommunicationActions(
      USER_AGENT_ID,
      4,
    )).toBe(1);
    expect((await stores.network.readNetworkDiagnostics()).events.filter(
      ({ actorAgentId, kind, replyToSequence }) => (
        actorAgentId === USER_AGENT_ID
        && kind === 'shared_message'
        && replyToSequence === interest.sequence
      ),
    )).toHaveLength(1);
  });

  it('requires direct guidance to revise the working note before any action', async () => {
    await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find early signals about durable personal agents.',
    );
    const guidance = await stores.workspace.saveGuidance(
      LOCAL_USER_ID,
      'Weak signals are useful again, but label them clearly.',
    );
    const tools = toolsByName(await createUserTools(
      stores,
      'wake_required_guidance_note',
      3,
      guidance.sequence,
      [],
      [guidance.sequence],
    ));

    expect(await tools.get('finish_without_action')!.execute({
      reason: 'Try to finish before revising the note.',
    })).toMatchObject({
      ok: false,
      error: expect.stringContaining('update_working_note'),
    });
    expect((await tools.get('post_shared_message')!.execute({
      reply_to_event_id: guidance.sequence,
      content: 'Try to communicate before revising the note.',
      source_event_ids: [guidance.sequence],
    })).ok).toBe(false);
    expect((await tools.get('update_working_note')!.execute({
      content:
        'Accept clearly labeled weak signals; an exact production mechanism is no longer required.',
    })).ok).toBe(true);
    expect((await tools.get('finish_without_action')!.execute({
      reason: 'The private direction changed; no public message is needed yet.',
    })).ok).toBe(true);

    const retryTools = toolsByName(await createUserTools(
      stores,
      'wake_required_guidance_note',
      3,
      guidance.sequence,
      [],
      [guidance.sequence],
    ));
    expect((await retryTools.get('finish_without_action')!.execute({
      reason: 'The durable revised note satisfies this retried wake.',
    })).ok).toBe(true);
    expect(await stores.communication.hasAgentUpdatedWorkingNoteThrough(
      USER_AGENT_ID,
      guidance.sequence,
    )).toBe(true);
  });

  it('reconstructs retry budgets and gives invalid legacy wakes one repair slot', async () => {
    const source = await registerSynthetic(stores, 'retry-repair');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find concrete long-running representative-agent experiments.',
    );
    const peer = await peerMessage(
      stores,
      source.agent.id,
      USER_AGENT_ID,
      'A peer has a concrete experiment to share.',
    );
    const legacyTools = toolsByName(await createUserTools(
      stores,
      'wake_legacy_repair',
      7,
      peer.sequence,
    ));
    expect((await legacyTools.get('report_finding')!.execute({
      content: 'The old implementation reported before making its request.',
      source_event_ids: [peer.sequence],
    })).ok).toBe(true);
    expect((await legacyTools.get('finish_without_action')!.execute({
      reason: 'The old implementation also consumed its second action.',
    })).ok).toBe(true);

    const retryTools = toolsByName(await createUserTools(
      stores,
      'wake_legacy_repair',
      7,
      peer.sequence,
      [interest.sequence],
    ));
    expect((await retryTools.get('post_shared_message')!.execute({
      reply_to_event_id: interest.sequence,
      content: 'Looking for concrete representative-agent experiments.',
      source_event_ids: [interest.sequence],
    })).ok).toBe(true);

    const events = (await stores.network.readNetworkDiagnostics()).events;
    expect(events.filter(({ wakeNumber, actorAgentId, kind }) => (
      wakeNumber === 7
      && actorAgentId === USER_AGENT_ID
      && ['shared_message', 'finding_reported', 'agent_wake_no_action']
        .includes(kind)
    ))).toHaveLength(3);
    expect(await stores.communication.findAgentPublishedRequestForTrigger(
      USER_AGENT_ID,
      interest.sequence,
    )).toBeDefined();
  });

  it('lets every representative report findings only to its own participant', async () => {
    const source = await registerSynthetic(stores, 'finding-owner');
    const request = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'Network request',
      content: 'Does anyone have a relevant observation?',
    });
    const tools = toolsByName(await new AgentCommunicationToolService(
      stores.communication,
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
    expect((await stores.network.readNetworkDiagnostics()).events).toContainEqual(
      expect.objectContaining({
        kind: 'finding_reported',
        actorAgentId: source.agent.id,
        targetParticipantId: source.participant.id,
      }),
    );
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).findings).toEqual([]);
  });

  it('separates request replies from content provenance', async () => {
    const source = await registerSynthetic(stores, 'reply-source');
    const request = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: source.agent.id,
      title: 'A peer asks for participant experience',
      content: 'Has anyone encountered a durable support-agent workflow?',
      metadata: { messageRole: 'request' },
    });
    const tools = toolsByName(await createUserTools(
      stores,
      'wake_reply_without_event_source',
      1,
      request.sequence,
    ));

    expect((await tools.get('post_shared_message')!.execute({
      reply_to_event_id: request.sequence,
      content: 'This participant has supplied a relevant private experience.',
      source_event_ids: [],
    })).ok).toBe(true);
    expect((await stores.network.readNetworkDiagnostics()).events.at(-1))
      .toMatchObject({
        kind: 'shared_message',
        replyToSequence: request.sequence,
        metadata: {
          messageRole: 'response',
          sourceEventIds: [],
        },
      });
  });

  it('requires explicit event references in text to be declared structurally', async () => {
    const requester = await registerSynthetic(stores, 'reference-requester');
    const contributor = await registerSynthetic(stores, 'reference-source');
    const request = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: requester.agent.id,
      title: 'A peer asks for an example',
      content: 'Does anyone have a concrete example?',
      metadata: { messageRole: 'request' },
    });
    const sourceMessage = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: contributor.agent.id,
      replyToSequence: request.sequence,
      title: 'Another participant responds',
      content: 'One participant supplied a concrete example.',
      metadata: { messageRole: 'response' },
    });
    const tools = toolsByName(await createUserTools(
      stores,
      'wake_reference_integrity',
      1,
      sourceMessage.sequence,
    ));

    expect(await tools.get('post_shared_message')!.execute({
      reply_to_event_id: request.sequence,
      content: `From #${sourceMessage.sequence}: one participant supplied an example.`,
      source_event_ids: [request.sequence],
    })).toMatchObject({
      ok: false,
      error: expect.stringContaining(`#${sourceMessage.sequence}`),
    });
    expect((await tools.get('post_shared_message')!.execute({
      reply_to_event_id: request.sequence,
      content: `From #${sourceMessage.sequence}: one participant supplied an example.`,
      source_event_ids: [sourceMessage.sequence],
    })).ok).toBe(true);
  });

  it('reports peer-sourced local findings once and preserves attribution', async () => {
    const source = await registerSynthetic(stores, 'local-finding-source');
    const relay = await registerSynthetic(stores, 'local-finding-relay');
    const message = await peerMessage(
      stores,
      source.agent.id,
      USER_AGENT_ID,
      'A participant supplied a specific observation.',
    );
    const first = toolsByName(await createUserTools(
      stores,
      'wake_finding_1',
      1,
      message.sequence,
    ));
    expect((await first.get('report_finding')!.execute({
      content: 'This observation may connect to your interest.',
      source_event_ids: [message.sequence],
    })).ok).toBe(true);

    const duplicate = toolsByName(await createUserTools(
      stores,
      'wake_finding_2',
      2,
      message.sequence,
    ));
    expect((await duplicate.get('report_finding')!.execute({
      content: 'The same source must not become another finding.',
      source_event_ids: [message.sequence],
    })).ok).toBe(false);
    const relayedMessage = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: relay.agent.id,
      replyToSequence: message.sequence,
      title: 'A relayed network observation',
      content: `From #${message.sequence}: ${message.content}`,
      metadata: {
        messageRole: 'response',
        sourceEventIds: [message.sequence],
      },
    });
    const relayedDuplicate = toolsByName(await createUserTools(
      stores,
      'wake_finding_relay',
      3,
      relayedMessage.sequence,
    ));
    expect((await relayedDuplicate.get('report_finding')!.execute({
      content: 'A relay must not turn one contribution into a new finding.',
      source_event_ids: [relayedMessage.sequence],
    })).ok).toBe(false);
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).findings).toEqual([
      expect.objectContaining({
        finding: expect.objectContaining({ title: 'New finding for You' }),
        sources: [expect.objectContaining({
          attribution: expect.objectContaining({
            participantId: source.participant.id,
          }),
        })],
        originatingSources: [expect.objectContaining({
          attribution: expect.objectContaining({
            participantId: source.participant.id,
          }),
        })],
      }),
    ]);
  });

  it('allows one representative contribution per principal-initiated request thread', async () => {
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Start one bounded request thread.',
    );
    const firstWake = toolsByName(await createUserTools(
      stores,
      'wake_thread_1',
      1,
      interest.sequence,
    ));
    expect((await firstWake.get('post_shared_message')!.execute({
      reply_to_event_id: interest.sequence,
      content: 'The first contribution is allowed.',
      source_event_ids: [interest.sequence],
    })).ok).toBe(true);

    const laterWake = toolsByName(await createUserTools(
      stores,
      'wake_thread_2',
      2,
      Number.MAX_SAFE_INTEGER,
    ));
    expect((await laterWake.get('post_shared_message')!.execute({
      reply_to_event_id: interest.sequence,
      content: 'A later wake cannot extend the same thread again.',
      source_event_ids: [interest.sequence],
    })).ok).toBe(false);
    const checkRequest = await stores.workspace.recordCheckRequest({
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A new explicit check',
      content: 'This event starts a different request thread.',
    });
    expect((await laterWake.get('post_shared_message')!.execute({
      reply_to_event_id: checkRequest.sequence,
      content: 'A new request allows a new contribution.',
      source_event_ids: [checkRequest.sequence],
    })).ok).toBe(true);
  });
});

async function registerSynthetic(
  stores: PostgresTestStores['stores'],
  key: string,
) {
  return await stores.network.registerParticipant({
    registrationKey: `sim:test:${key}`,
    kind: 'synthetic',
    displayName: `Synthetic ${key}`,
    privateContext: `Private context for ${key}.`,
  });
}

async function peerMessage(
  stores: PostgresTestStores['stores'],
  actorAgentId: string,
  targetAgentId: string,
  content: string,
) {
  return await stores.communication.appendCommunicationEvent({
    kind: 'direct_message',
    actorAgentId,
    targetAgentId,
    title: 'Participant message',
    content,
  });
}

async function createUserTools(
  stores: PostgresTestStores['stores'],
  wakeId: string,
  wakeNumber: number,
  horizonSequence = Number.MAX_SAFE_INTEGER,
  requiredRequestSourceIds: number[] = [],
  requiredWorkingNoteSourceIds: number[] = [],
) {
  return await new AgentCommunicationToolService(
    stores.communication,
    await stores.workspace.requireParticipantAgent(LOCAL_USER_ID),
    await requireLocalParticipant(stores),
    wakeId,
    wakeNumber,
    horizonSequence,
    requiredRequestSourceIds,
    requiredWorkingNoteSourceIds,
  ).definitions();
}

function toolsByName<T extends { name: string }>(tools: T[]): Map<string, T> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

async function requireLocalParticipant(
  stores: PostgresTestStores['stores'],
) {
  const participant = (await stores.representative.listParticipants())
    .find(({ id }) => id === LOCAL_USER_ID);
  if (!participant) {
    throw new Error(`Participant not found: ${LOCAL_USER_ID}`);
  }
  return participant;
}
