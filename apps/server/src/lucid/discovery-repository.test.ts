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
} from './local-participant.js';

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

  it('starts with only the local participant and returns a scoped product view', async () => {
    const product = await repository.readSnapshot();
    const diagnostics = await repository.readNetworkDiagnostics();

    expect(product.workspace.currentWake).toBe(0);
    expect(product.user).toMatchObject({
      id: LOCAL_USER_ID,
      kind: 'human',
      displayName: 'You',
    });
    expect(product.representative).toMatchObject({
      id: USER_AGENT_ID,
      participant: { id: LOCAL_USER_ID },
    });
    expect(diagnostics.participants.map(({ id }) => id)).toEqual([
      LOCAL_USER_ID,
    ]);
    expect(diagnostics.agents.map(({ id }) => id)).toEqual([USER_AGENT_ID]);
    expect(JSON.stringify(product)).not.toContain('privateContext');
    expect(JSON.stringify(product)).not.toContain('registrationKey');
  });

  it('registers independent participants idempotently without exposing private context', async () => {
    const input = {
      registrationKey: 'sim:test:builder',
      kind: 'synthetic' as const,
      displayName: 'Independent builder',
      privateContext: 'Private observations from small product experiments.',
    };

    const first = await repository.registerParticipant(input);
    const second = await repository.registerParticipant(input);
    const diagnostics = await repository.readNetworkDiagnostics();

    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      participant: { id: first.participant.id },
      agent: { id: first.agent.id },
    });
    expect(diagnostics.participants).toHaveLength(2);
    expect(diagnostics.agents).toHaveLength(2);
    expect(JSON.stringify(diagnostics)).not.toContain(input.privateContext);
    await expect(repository.registerParticipant({
      ...input,
      privateContext: 'A conflicting identity payload.',
    })).rejects.toThrow('already belongs to a different participant profile');
  });

  it('delivers each participant input only to its own representative', async () => {
    const source = await registerSynthetic(repository, 'source');
    const event = await repository.saveParticipantInput(
      source.participant.id,
      'One new observation arrived from this participant.',
      'sim-input:source:1',
    );

    expect(
      (await repository.listEventsVisibleToAgent(source.agent.id, 0))
        .map(({ sequence }) => sequence),
    ).toContain(event.sequence);
    expect(
      (await repository.listEventsVisibleToAgent(USER_AGENT_ID, 0))
        .map(({ sequence }) => sequence),
    ).not.toContain(event.sequence);
    expect(await repository.saveParticipantInput(
      source.participant.id,
      'A retry must return the original event.',
      'sim-input:source:1',
    )).toEqual(event);
  });

  it('enforces consent and mailbox floors across a human participant lifecycle', async () => {
    const historicalMessage = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'Message from before the participant joined',
      content: 'A new participant must not inherit this old message.',
    });
    const privateContext = 'I approved one specific personal observation.';
    const created = await repository.registerParticipant({
      registrationKey: 'human:test:avery',
      kind: 'human',
      displayName: 'Avery',
      privateContext,
      contextApproved: true,
    });

    expect(created.participant.contextConsentAt).toEqual(expect.any(String));
    expect(await repository.listEventsVisibleToAgent(created.agent.id, 0))
      .not.toContainEqual(expect.objectContaining({
        sequence: historicalMessage.sequence,
      }));
    expect(JSON.stringify(await repository.readNetworkDiagnostics()))
      .not.toContain(privateContext);

    await repository.setParticipantStatus(created.participant.id, 'disabled');
    const pausedMessage = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'Message sent while paused',
      content: 'This message must not be replayed after resume.',
    });
    await repository.setParticipantStatus(created.participant.id, 'active');
    expect(await repository.readVisibleEventsBySequence(
      created.agent.id,
      [pausedMessage.sequence],
    )).toEqual([]);

    const retired = await repository.retireParticipant(created.participant.id);
    expect(retired.participant).toMatchObject({
      status: 'retired',
      privateContext: '',
    });
    expect((await repository.listActiveAgents()).map(({ id }) => id))
      .not.toContain(created.agent.id);
  });

  it('projects source attribution without exposing the global agent directory', async () => {
    const source = await registerSynthetic(repository, 'attributed-source');
    const sourceMessage = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Specific response',
      content: 'A participant supplied one relevant observation.',
    });
    await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'New finding for You',
      content: 'The observation may connect to the saved interest.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });

    const snapshot = await repository.readSnapshot();
    expect(snapshot.findings[0]).toMatchObject({
      origin: 'ambient-network',
      sources: [expect.objectContaining({
        message: expect.objectContaining({ sequence: sourceMessage.sequence }),
        attribution: expect.objectContaining({
          agentId: source.agent.id,
          participantId: source.participant.id,
          participantDisplayName: source.participant.displayName,
          participantKind: 'synthetic',
        }),
      })],
    });
    expect(snapshot.findings[0]?.assignmentSequence).toBeUndefined();
    expect(snapshot).not.toHaveProperty('agents');
    expect(snapshot).not.toHaveProperty('events');
  });

  it('projects the latest participant-owned network request lifecycle', async () => {
    const source = await registerSynthetic(repository, 'request-source');
    const interest = await repository.saveInterest(
      'Find a concrete example of long-running representative memory.',
    );

    expect((await repository.readSnapshot()).networkActivity).toEqual({
      assignment: interest,
      responseCount: 0,
      originatingResponseCount: 0,
      originatingParticipantCount: 0,
    });

    const request = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'Your representative asks the network',
      content: 'Who has observed a concrete long-running memory failure?',
      metadata: { sourceEventIds: [interest.sequence] },
    });
    expect(await repository.hasAgentPublishedRequestForTrigger(
      USER_AGENT_ID,
      interest.sequence,
    )).toBe(true);
    expect((await repository.readSnapshot()).networkActivity).toMatchObject({
      assignment: { sequence: interest.sequence },
      request: { sequence: request.sequence },
      responseCount: 0,
    });

    const response = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      replyToSequence: request.sequence,
      title: 'A participant replies',
      content: 'One operator lost rejection rules after a process restart.',
      metadata: { sourceEventIds: [request.sequence] },
    });
    await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A response to the current assignment',
      content: 'A peer described a specific long-running memory failure.',
      metadata: { sourceEventIds: [response.sequence] },
    });
    expect((await repository.readSnapshot()).networkActivity).toMatchObject({
      request: { sequence: request.sequence },
      responseCount: 1,
      originatingResponseCount: 1,
      originatingParticipantCount: 1,
      latestResponseAt: response.createdAt,
    });
    expect((await repository.readSnapshot()).findings[0]).toMatchObject({
      assignmentSequence: interest.sequence,
      origin: 'request-thread',
      outboundMessages: [expect.objectContaining({
        sequence: request.sequence,
      })],
    });

    const check = await repository.appendEvent({
      kind: 'check_requested',
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Check the current assignment again',
      content: interest.content,
    });
    expect((await repository.readSnapshot()).networkActivity).toMatchObject({
      assignment: { sequence: interest.sequence },
      responseCount: 0,
    });
    expect((await repository.readSnapshot()).networkActivity?.request)
      .toBeUndefined();

    const refreshedRequest = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: check.sequence,
      title: 'Your representative checks the network again',
      content: 'Who has a newer concrete example?',
      metadata: { sourceEventIds: [check.sequence] },
    });
    expect((await repository.readSnapshot()).networkActivity).toMatchObject({
      assignment: { sequence: interest.sequence },
      request: { sequence: refreshedRequest.sequence },
      responseCount: 0,
    });
  });

  it('collapses relays into their originating participant contribution', async () => {
    const origin = await registerSynthetic(repository, 'origin');
    const relay = await registerSynthetic(repository, 'relay');
    const interest = await repository.saveInterest(
      'Find a concrete operator workflow for long-running agents.',
    );
    const request = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'Your representative asks the network',
      content: 'Who has a concrete long-running operator workflow?',
      metadata: {
        messageRole: 'request',
        sourceEventIds: [interest.sequence],
      },
    });
    const originInput = await repository.saveParticipantInput(
      origin.participant.id,
      'A support operator keeps unresolved cases across daily agent wakes.',
      'test:origin:workflow',
    );
    const originResponse = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: origin.agent.id,
      replyToSequence: request.sequence,
      title: 'An originating participant responds',
      content: originInput.content,
      metadata: {
        messageRole: 'response',
        sourceEventIds: [originInput.sequence],
      },
    });
    const relayedResponse = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: relay.agent.id,
      replyToSequence: request.sequence,
      title: 'Another representative relays the response',
      content: `From #${originResponse.sequence}: ${originResponse.content}`,
      metadata: {
        messageRole: 'response',
        sourceEventIds: [originResponse.sequence],
      },
    });
    await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A response to the current assignment',
      content: 'A support workflow may be relevant.',
      metadata: {
        sourceEventIds: [originResponse.sequence, relayedResponse.sequence],
      },
    });

    const snapshot = await repository.readSnapshot();
    expect(snapshot.networkActivity).toMatchObject({
      responseCount: 2,
      originatingResponseCount: 1,
      originatingParticipantCount: 1,
    });
    expect(snapshot.findings[0]).toMatchObject({
      sources: [
        expect.objectContaining({
          message: expect.objectContaining({ sequence: originResponse.sequence }),
        }),
        expect.objectContaining({
          message: expect.objectContaining({ sequence: relayedResponse.sequence }),
        }),
      ],
      originatingSources: [expect.objectContaining({
        message: expect.objectContaining({ sequence: originResponse.sequence }),
        attribution: expect.objectContaining({
          participantId: origin.participant.id,
        }),
      })],
    });
    expect(await repository.hasParticipantFindingUsingAnyOrigin(
      LOCAL_USER_ID,
      [relayedResponse.sequence],
    )).toBe(true);
  });

  it('projects participant-scoped working history at a retry-stable event horizon', async () => {
    const source = await registerSynthetic(repository, 'memory-source');
    const interest = await repository.saveInterest(
      'Find products that preserve useful unfinished work.',
    );
    const firstNote = await repository.appendEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Look for concrete examples involving unfinished work.',
      metadata: { throughSequence: interest.sequence, derived: true },
    });
    const sourceMessage = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      title: 'A concrete network observation',
      content: 'A prototype retained abandoned drafts for later comparison.',
    });
    const finding = await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'New finding for You',
      content: 'Abandoned drafts may be useful comparison material.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });
    const feedback = await repository.saveFeedback(
      LOCAL_USER_ID,
      finding.sequence,
      'Useful only when the example names a real workflow.',
    );
    const revisedNote = await repository.appendEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a named workflow before reporting similar examples.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });

    const beforeRevision = await repository.readRepresentativeWorkingContext(
      USER_AGENT_ID,
      feedback.sequence,
    );
    expect(beforeRevision).toMatchObject({
      principalInputs: [expect.objectContaining({ sequence: interest.sequence })],
      workingNote: expect.objectContaining({ sequence: firstNote.sequence }),
      findings: [expect.objectContaining({
        finding: expect.objectContaining({ sequence: finding.sequence }),
        feedback: expect.objectContaining({ sequence: feedback.sequence }),
      })],
    });

    const afterRevision = await repository.readRepresentativeWorkingContext(
      USER_AGENT_ID,
      revisedNote.sequence,
    );
    expect(afterRevision.workingNote).toMatchObject({
      sequence: revisedNote.sequence,
      content: 'Require a named workflow before reporting similar examples.',
    });
    expect((await repository.readSnapshot()).workingNote).toEqual(
      revisedNote,
    );
    expect(await repository.readRepresentativeWorkingContext(
      source.agent.id,
      revisedNote.sequence,
    )).toMatchObject({
      principalInputs: [],
      findings: [],
      workingNote: undefined,
    });
  });

  it('projects persisted follow-through after the latest feedback', async () => {
    const source = await registerSynthetic(repository, 'follow-through-source');
    await repository.saveInterest(
      'Find product decisions changed by context outside the builder workspace.',
    );
    const firstMessage = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      title: 'An initial network lead',
      content: 'A builder changed onboarding after one outside conversation.',
    });
    const firstFinding = await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'An initial finding',
      content: 'An outside conversation may have changed onboarding.',
      metadata: { sourceEventIds: [firstMessage.sequence] },
    });
    const feedback = await repository.saveFeedback(
      LOCAL_USER_ID,
      firstFinding.sequence,
      'Only continue with a before-and-after decision and named mechanism.',
    );

    expect((await repository.readSnapshot()).feedbackFollowThrough)
      .toMatchObject({
        feedback: { sequence: feedback.sequence },
        sourceFinding: { sequence: firstFinding.sequence },
      });

    const note = await repository.appendEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a before-and-after decision and named mechanism.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });
    const check = await repository.appendEvent({
      kind: 'check_requested',
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'You ask Lucid to check now',
      content: 'Continue with the participant feedback.',
      metadata: { latestFeedbackSequence: feedback.sequence },
    });
    const request = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: check.sequence,
      title: 'Your representative asks a narrower question',
      content: 'Who has a before-and-after decision and named mechanism?',
      metadata: { sourceEventIds: [check.sequence], messageRole: 'request' },
    });
    const sourceInput = await repository.saveParticipantInput(
      source.participant.id,
      'A team replaced persona setup with one active problem after support interviews exposed the missing handoff.',
      'test:follow-through:result',
    );
    const response = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: source.agent.id,
      replyToSequence: request.sequence,
      title: 'A participant answers the narrower request',
      content: sourceInput.content,
      metadata: {
        sourceEventIds: [sourceInput.sequence],
        messageRole: 'response',
      },
    });
    const resultingFinding = await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A later finding',
      content: 'The onboarding decision now includes a concrete mechanism.',
      metadata: { sourceEventIds: [response.sequence] },
    });

    expect((await repository.readSnapshot()).feedbackFollowThrough)
      .toMatchObject({
        feedback: { sequence: feedback.sequence, content: feedback.content },
        sourceFinding: { sequence: firstFinding.sequence },
        workingNote: { sequence: note.sequence, content: note.content },
        request: { sequence: request.sequence, content: request.content },
        resultingFinding: {
          finding: {
            sequence: resultingFinding.sequence,
            content: resultingFinding.content,
          },
        },
      });

    const laterCheck = await repository.appendEvent({
      kind: 'check_requested',
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'You ask Lucid to check again',
      content: 'Apply the same feedback to a more precise request.',
      metadata: { latestFeedbackSequence: feedback.sequence },
    });
    const laterRequest = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: laterCheck.sequence,
      title: 'Your representative asks a more precise question',
      content: 'Which product decision changed, and by what mechanism?',
      metadata: {
        sourceEventIds: [laterCheck.sequence],
        messageRole: 'request',
      },
    });
    const laterResponse = await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: source.agent.id,
      replyToSequence: laterRequest.sequence,
      title: 'A participant answers the more precise request',
      content: 'A participant inbox replaced a global task dashboard.',
      metadata: { sourceEventIds: [], messageRole: 'response' },
    });
    const laterFinding = await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A more precise later finding',
      content: 'The global dashboard became a participant inbox.',
      metadata: { sourceEventIds: [laterResponse.sequence] },
    });

    expect((await repository.readSnapshot()).feedbackFollowThrough)
      .toMatchObject({
        request: {
          sequence: laterRequest.sequence,
          content: laterRequest.content,
        },
        resultingFinding: {
          finding: {
            sequence: laterFinding.sequence,
            content: laterFinding.content,
          },
        },
      });
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
    const firstNote = await repository.appendEvent({
      wakeNumber: firstWake!.wakeNumber,
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      idempotencyKey: `${firstWake!.wakeId}:working-note`,
      title: 'Original working note',
      content: 'This note was written by the first attempt.',
      metadata: { throughSequence: firstWake!.horizonSequence },
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
      workingContext: { workingNote: undefined },
    });
    expect(await repository.appendEvent({
      wakeNumber: retriedWake!.wakeNumber,
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      idempotencyKey: `${retriedWake!.wakeId}:action:1`,
      title: 'Replacement action',
      content: 'This must not create a second side effect.',
    })).toEqual(firstEvent);
    expect(await repository.appendEvent({
      wakeNumber: retriedWake!.wakeNumber,
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      idempotencyKey: `${retriedWake!.wakeId}:working-note`,
      title: 'Replacement working note',
      content: 'This retry must return the first note.',
    })).toEqual(firstNote);
    expect((await repository.readNetworkDiagnostics()).events.filter(
      ({ kind }) => kind === 'shared_message',
    )).toHaveLength(1);
  });

  it('recovers an interrupted wake without consuming unread input', async () => {
    const interest = await repository.saveInterest(
      'Keep this input unread until the wake succeeds.',
    );
    const claimed = await repository.beginAgentWake(
      USER_AGENT_ID,
      'wake_before_restart',
    );
    expect(claimed?.visibleEvents.map(({ sequence }) => sequence))
      .toContain(interest.sequence);

    await repository.initialize();
    const resumed = await repository.beginAgentWake(
      USER_AGENT_ID,
      'wake_after_restart',
    );
    expect(resumed).toMatchObject({
      wakeId: claimed!.wakeId,
      wakeNumber: claimed!.wakeNumber,
      horizonSequence: claimed!.horizonSequence,
    });
    expect(resumed?.visibleEvents.map(({ sequence }) => sequence))
      .toContain(interest.sequence);
    expect((await repository.readNetworkDiagnostics()).events).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        title: 'Interrupted agent wakes recovered',
      }),
    );
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
