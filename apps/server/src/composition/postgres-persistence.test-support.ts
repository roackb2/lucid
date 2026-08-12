import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from '../lucid/local-participant.js';
import type { ParticipantNetworkStore } from '../lucid/network/store.js';
import type {
  AgentCommunicationStore,
} from '../lucid/representative/communication/store.js';
import type {
  RepresentativeWakeStore,
} from '../lucid/representative/store.js';
import type { DiscoveryWorkspaceStore } from '../lucid/workspace/store.js';

export type LucidStoreSet = {
  workspace: DiscoveryWorkspaceStore;
  network: ParticipantNetworkStore;
  representative: RepresentativeWakeStore;
  communication: AgentCommunicationStore;
};

export type LucidStoreContractOptions = {
  name: string;
  create: () => Promise<{
    stores: LucidStoreSet;
    close: () => Promise<void>;
  }>;
};

/**
 * Shared behavioral contract for the composed durable Lucid stores.
 *
 * Storage-specific tests still own transaction contention and reconnect
 * behavior. Keeping domain behavior here prevents PostgreSQL from becoming a
 * schema-compatible but semantically different implementation.
 */
export const defineLucidStoreContract = (
  options: LucidStoreContractOptions,
): void => describe(options.name, () => {
  let stores: LucidStoreSet;
  let close: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    ({ stores, close } = await options.create());
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('starts with only the local participant and returns a scoped product view', async () => {
    const product = await stores.workspace.readSnapshot(LOCAL_USER_ID);
    const diagnostics = await stores.network.readNetworkDiagnostics();

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

    const first = await stores.network.registerParticipant(input);
    const second = await stores.network.registerParticipant(input);
    const diagnostics = await stores.network.readNetworkDiagnostics();

    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      participant: { id: first.participant.id },
      agent: { id: first.agent.id },
    });
    expect(diagnostics.participants).toHaveLength(2);
    expect(diagnostics.agents).toHaveLength(2);
    expect(JSON.stringify(diagnostics)).not.toContain(input.privateContext);
    await expect(stores.network.registerParticipant({
      ...input,
      privateContext: 'A conflicting identity payload.',
    })).rejects.toThrow('already belongs to a different participant profile');
  });

  it('delivers each participant input only to its own representative', async () => {
    const source = await registerSynthetic(stores, 'source');
    const event = await stores.network.saveParticipantInput(
      source.participant.id,
      'One new observation arrived from this participant.',
      'sim-input:source:1',
    );

    expect(
      (await stores.communication.listEventsVisibleToAgent(source.agent.id, 0))
        .map(({ sequence }) => sequence),
    ).toContain(event.sequence);
    expect(
      (await stores.communication.listEventsVisibleToAgent(USER_AGENT_ID, 0))
        .map(({ sequence }) => sequence),
    ).not.toContain(event.sequence);
    expect(await stores.network.saveParticipantInput(
      source.participant.id,
      'A retry must return the original event.',
      'sim-input:source:1',
    )).toEqual(event);
  });

  it('enforces consent and mailbox floors across a human participant lifecycle', async () => {
    const historicalMessage = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'Message from before the participant joined',
      content: 'A new participant must not inherit this old message.',
    });
    const privateContext = 'I approved one specific personal observation.';
    const created = await stores.network.registerParticipant({
      registrationKey: 'human:test:avery',
      kind: 'human',
      displayName: 'Avery',
      privateContext,
      contextApproved: true,
    });

    expect(created.participant.contextConsentAt).toEqual(expect.any(String));
    expect(await stores.communication.listEventsVisibleToAgent(created.agent.id, 0))
      .not.toContainEqual(expect.objectContaining({
        sequence: historicalMessage.sequence,
      }));
    expect(JSON.stringify(await stores.network.readNetworkDiagnostics()))
      .not.toContain(privateContext);

    await stores.network.setParticipantStatus(created.participant.id, 'disabled');
    const pausedMessage = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      title: 'Message sent while paused',
      content: 'This message must not be replayed after resume.',
    });
    await stores.network.setParticipantStatus(created.participant.id, 'active');
    expect(await stores.communication.readVisibleEventsBySequence(
      created.agent.id,
      [pausedMessage.sequence],
    )).toEqual([]);

    const retired = await stores.network.retireParticipant(created.participant.id);
    expect(retired.participant).toMatchObject({
      status: 'retired',
      privateContext: '',
    });
    expect((await stores.communication.listActiveAgents()).map(({ id }) => id))
      .not.toContain(created.agent.id);
  });

  it('projects source attribution without exposing the global agent directory', async () => {
    const source = await registerSynthetic(stores, 'attributed-source');
    const sourceMessage = await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Specific response',
      content: 'A participant supplied one relevant observation.',
    });
    await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'New finding for You',
      content: 'The observation may connect to the saved interest.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });

    const snapshot = await stores.workspace.readSnapshot(LOCAL_USER_ID);
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
    const source = await registerSynthetic(stores, 'request-source');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find a concrete example of long-running representative memory.',
    );

    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toEqual({
      assignment: interest,
      previousRequests: [],
    });

    const request = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'Your representative asks the network',
      content: 'Who has observed a concrete long-running memory failure?',
      metadata: { sourceEventIds: [interest.sequence] },
    });
    expect(await stores.communication.findAgentPublishedRequestForTrigger(
      USER_AGENT_ID,
      interest.sequence,
    )).toMatchObject({ sequence: request.sequence });
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toMatchObject({
      assignment: { sequence: interest.sequence },
      request: { sequence: request.sequence },
      requestProgress: {
        phase: 'waiting-for-network',
        responseCount: 0,
        pendingReviewCount: 0,
      },
    });

    const response = await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      replyToSequence: request.sequence,
      title: 'A participant replies',
      content: 'One operator lost rejection rules after a process restart.',
      metadata: { sourceEventIds: [request.sequence] },
    });
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toMatchObject({
      request: { sequence: request.sequence },
      requestProgress: {
        phase: 'messages-pending-review',
        responseCount: 1,
        pendingReviewCount: 1,
        originatingResponseCount: 1,
        originatingParticipantCount: 1,
        latestResponseAt: response.createdAt,
      },
    });

    const responseWake = await stores.representative.beginAgentWake(
      USER_AGENT_ID,
      'wake_review_response',
    );
    expect(responseWake).toBeDefined();
    const reviewCompletion = await stores.representative.recordWakeCompletion({
      wakeNumber: responseWake!.wakeNumber,
      actorAgentId: USER_AGENT_ID,
      title: 'The representative completes response review',
      content: 'The delivered response was processed.',
      metadata: { wakeId: responseWake!.wakeId },
    });
    await stores.representative.completeAgentWake(
      USER_AGENT_ID,
      responseWake!.claimToken,
      responseWake!.horizonSequence,
    );
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toMatchObject({
      request: { sequence: request.sequence },
      requestProgress: {
        phase: 'reviewed-without-finding',
        responseCount: 1,
        pendingReviewCount: 0,
        reviewedAt: reviewCompletion.createdAt,
      },
    });

    await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A response to the current assignment',
      content: 'A peer described a specific long-running memory failure.',
      metadata: { sourceEventIds: [response.sequence] },
    });
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toMatchObject({
      request: { sequence: request.sequence },
      requestProgress: {
        phase: 'finding-reported',
        responseCount: 1,
        pendingReviewCount: 0,
        originatingResponseCount: 1,
        originatingParticipantCount: 1,
        latestResponseAt: response.createdAt,
      },
    });
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).findings[0]).toMatchObject({
      assignmentSequence: interest.sequence,
      origin: 'request-thread',
      outboundMessages: [expect.objectContaining({
        sequence: request.sequence,
      })],
    });

    const check = await stores.workspace.recordCheckRequest({
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Check the current assignment again',
      content: interest.content,
    });
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toMatchObject({
      assignment: { sequence: interest.sequence },
      previousRequests: [{
        request: { sequence: request.sequence },
        progress: { phase: 'finding-reported' },
        linkedFindings: [expect.objectContaining({
          content: 'A peer described a specific long-running memory failure.',
        })],
      }],
    });
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity?.request)
      .toBeUndefined();

    const refreshedRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: check.sequence,
      title: 'Your representative checks the network again',
      content: 'Who has a newer concrete example?',
      metadata: { sourceEventIds: [check.sequence] },
    });
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toMatchObject({
      assignment: { sequence: interest.sequence },
      request: { sequence: refreshedRequest.sequence },
      requestProgress: {
        phase: 'waiting-for-network',
        responseCount: 0,
        pendingReviewCount: 0,
      },
      previousRequests: [{
        request: { sequence: request.sequence },
        progress: { phase: 'finding-reported' },
      }],
    });
  });

  it('preserves completed silence and guidance across later request cycles', async () => {
    const source = await registerSynthetic(stores, 'request-history');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find durable examples of participant-controlled representative work.',
    );
    const firstRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'The first request',
      content: 'Who has a participant-controlled representative example?',
      metadata: { sourceEventIds: [interest.sequence] },
    });
    await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: source.agent.id,
      replyToSequence: firstRequest.sequence,
      title: 'A non-qualifying response',
      content: 'One synthetic scenario resembles that idea.',
      metadata: { sourceEventIds: [] },
    });
    const responseWake = await stores.representative.beginAgentWake(
      USER_AGENT_ID,
      'wake_history_silence',
    );
    await stores.representative.recordWakeCompletion({
      wakeNumber: responseWake!.wakeNumber,
      actorAgentId: USER_AGENT_ID,
      title: 'Review finishes without a finding',
      content: 'The response did not satisfy the assignment.',
      metadata: { wakeId: responseWake!.wakeId },
    });
    await stores.representative.completeAgentWake(
      USER_AGENT_ID,
      responseWake!.claimToken,
      responseWake!.horizonSequence,
    );

    const guidance = await stores.workspace.saveGuidance(
      LOCAL_USER_ID,
      'Only keep independently named examples with a participant-visible result.',
    );
    const guidedCheck = await stores.workspace.recordCheckRequest({
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Apply the newer guidance',
      content: 'Look again using the participant correction.',
      metadata: { latestGuidanceSequence: guidance.sequence },
    });
    const guidedRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: guidedCheck.sequence,
      title: 'A guidance-shaped request',
      content: 'Who has an independently named example with a visible result?',
      metadata: { sourceEventIds: [guidedCheck.sequence] },
    });
    const latestCheck = await stores.workspace.recordCheckRequest({
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Start one newer check',
      content: 'Look for a newer increment.',
    });
    const latestRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: latestCheck.sequence,
      title: 'The current request',
      content: 'Who has a newer concrete increment?',
      metadata: { sourceEventIds: [latestCheck.sequence] },
    });

    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toMatchObject({
      request: { sequence: latestRequest.sequence },
      previousRequests: [
        {
          trigger: { sequence: guidedCheck.sequence },
          request: { sequence: guidedRequest.sequence },
          guidance: {
            sequence: guidance.sequence,
            content: guidance.content,
          },
          progress: { phase: 'waiting-for-network' },
          linkedFindings: [],
        },
        {
          trigger: { sequence: interest.sequence },
          request: { sequence: firstRequest.sequence },
          progress: {
            phase: 'reviewed-without-finding',
            responseCount: 1,
            pendingReviewCount: 0,
          },
          linkedFindings: [],
        },
      ],
    });
  });

  it('bounds previous request history to the five most recent cycles', async () => {
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Track a bounded sequence of network requests.',
    );
    const requests = [await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'Initial request',
      content: 'Start the bounded history.',
      metadata: { sourceEventIds: [interest.sequence] },
    })];

    for (let index = 1; index <= 6; index += 1) {
      const check = await stores.workspace.recordCheckRequest({
        targetAgentId: USER_AGENT_ID,
        targetParticipantId: LOCAL_USER_ID,
        title: `Check ${index}`,
        content: `Look for increment ${index}.`,
      });
      requests.push(await stores.communication.appendCommunicationEvent({
        kind: 'shared_message',
        actorAgentId: USER_AGENT_ID,
        replyToSequence: check.sequence,
        title: `Request ${index}`,
        content: `Who has increment ${index}?`,
        metadata: { sourceEventIds: [check.sequence] },
      }));
    }

    const activity = (await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity;
    expect(activity?.request?.sequence).toBe(requests.at(-1)!.sequence);
    expect(activity?.previousRequests.map(({ request }) => request.sequence))
      .toEqual(requests.slice(1, -1).reverse().map(({ sequence }) => sequence));
  });

  it('projects retry-era duplicate requests as one lifecycle', async () => {
    const source = await registerSynthetic(stores, 'duplicate-request');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find one concrete example of deliberate completed silence.',
    );
    const request = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'The canonical request',
      content: 'Who has one concrete example?',
      metadata: { sourceEventIds: [interest.sequence] },
    });
    const duplicateRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'A retry artifact',
      content: 'A retry regenerated the same semantic request.',
      metadata: { sourceEventIds: [interest.sequence] },
    });
    const canonicalResponse = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: source.agent.id,
      replyToSequence: request.sequence,
      title: 'A response to the canonical request',
      content: 'A durable mailbox marks a completed review explicitly.',
      metadata: { sourceEventIds: [] },
    });
    await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: source.agent.id,
      replyToSequence: duplicateRequest.sequence,
      title: 'A response routed through the retry artifact',
      content: 'A progress view separates unread delivery from reviewed silence.',
      metadata: { sourceEventIds: [] },
    });
    const responseWake = await stores.representative.beginAgentWake(
      USER_AGENT_ID,
      'wake_duplicate_request_review',
    );
    await stores.communication.appendCommunicationEvent({
      wakeNumber: responseWake!.wakeNumber,
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A linked finding',
      content: 'A durable mailbox makes completed silence legible.',
      metadata: { sourceEventIds: [canonicalResponse.sequence] },
    });
    await stores.representative.recordWakeCompletion({
      wakeNumber: responseWake!.wakeNumber,
      actorAgentId: USER_AGENT_ID,
      title: 'The representative completes review',
      content: 'Every delivered response was reviewed.',
      metadata: { wakeId: responseWake!.wakeId },
    });
    await stores.representative.completeAgentWake(
      USER_AGENT_ID,
      responseWake!.claimToken,
      responseWake!.horizonSequence,
    );

    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toMatchObject({
      request: { sequence: request.sequence },
      requestProgress: {
        phase: 'finding-reported',
        responseCount: 2,
        pendingReviewCount: 0,
      },
    });
  });

  it('collapses relays into their originating participant contribution', async () => {
    const origin = await registerSynthetic(stores, 'origin');
    const relay = await registerSynthetic(stores, 'relay');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find a concrete operator workflow for long-running agents.',
    );
    const request = await stores.communication.appendCommunicationEvent({
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
    const originInput = await stores.network.saveParticipantInput(
      origin.participant.id,
      'A support operator keeps unresolved cases across daily agent wakes.',
      'test:origin:workflow',
    );
    const originResponse = await stores.communication.appendCommunicationEvent({
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
    const relayedResponse = await stores.communication.appendCommunicationEvent({
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
    await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A response to the current assignment',
      content: 'A support workflow may be relevant.',
      metadata: {
        sourceEventIds: [originResponse.sequence, relayedResponse.sequence],
      },
    });

    const snapshot = await stores.workspace.readSnapshot(LOCAL_USER_ID);
    expect(snapshot.networkActivity).toMatchObject({
      requestProgress: {
        responseCount: 2,
        originatingResponseCount: 1,
        originatingParticipantCount: 1,
      },
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
    expect(await stores.communication.hasParticipantFindingUsingAnyOrigin(
      LOCAL_USER_ID,
      [relayedResponse.sequence],
    )).toBe(true);
  });

  it('projects participant-scoped working history at a retry-stable event horizon', async () => {
    const source = await registerSynthetic(stores, 'memory-source');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find products that preserve useful unfinished work.',
    );
    const firstNote = await stores.communication.appendCommunicationEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Look for concrete examples involving unfinished work.',
      metadata: { throughSequence: interest.sequence, derived: true },
    });
    const sourceMessage = await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      title: 'A concrete network observation',
      content: 'A prototype retained abandoned drafts for later comparison.',
    });
    const finding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'New finding for You',
      content: 'Abandoned drafts may be useful comparison material.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });
    const feedback = await stores.workspace.saveFeedback(
      LOCAL_USER_ID,
      finding.sequence,
      'Useful only when the example names a real workflow.',
    );
    const revisedNote = await stores.communication.appendCommunicationEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a named workflow before reporting similar examples.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });

    const beforeRevision = await stores.workspace.readRepresentativeWorkingContext(
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

    const afterRevision = await stores.workspace.readRepresentativeWorkingContext(
      USER_AGENT_ID,
      revisedNote.sequence,
    );
    expect(afterRevision.workingNote).toMatchObject({
      sequence: revisedNote.sequence,
      content: 'Require a named workflow before reporting similar examples.',
    });
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).workingNote).toEqual(
      revisedNote,
    );
    expect(await stores.workspace.readRepresentativeWorkingContext(
      source.agent.id,
      revisedNote.sequence,
    )).toMatchObject({
      principalInputs: [],
      findings: [],
      workingNote: undefined,
    });
  });

  it('keeps direct guidance private and traces the representative revision', async () => {
    const peer = await registerSynthetic(stores, 'guidance-peer');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find early signals about durable personal agents.',
    );
    const priorNote = await stores.communication.appendCommunicationEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require an exact production mechanism before reporting.',
      metadata: { throughSequence: interest.sequence, derived: true },
    });
    const guidance = await stores.workspace.saveGuidance(
      LOCAL_USER_ID,
      'Weak signals are useful again, but label them clearly.',
    );

    expect(await stores.communication.listEventsVisibleToAgent(
      USER_AGENT_ID,
      interest.sequence,
    )).toContainEqual(expect.objectContaining({
      sequence: guidance.sequence,
      kind: 'guidance_saved',
    }));
    expect(await stores.communication.listEventsVisibleToAgent(
      peer.agent.id,
      0,
    )).not.toContainEqual(expect.objectContaining({
      sequence: guidance.sequence,
    }));
    expect((await stores.workspace.readRepresentativeWorkingContext(
      USER_AGENT_ID,
      guidance.sequence,
    )).principalInputs).toContainEqual(expect.objectContaining({
      sequence: guidance.sequence,
      content: guidance.content,
    }));
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).guidanceFollowThrough)
      .toMatchObject({
        guidance: { sequence: guidance.sequence },
        priorWorkingNote: { sequence: priorNote.sequence },
        workingNote: undefined,
      });
    expect(await stores.communication.hasAgentUpdatedWorkingNoteThrough(
      USER_AGENT_ID,
      guidance.sequence,
    )).toBe(false);

    const revisedNote = await stores.communication.appendCommunicationEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content:
        'Accept weak signals when they are clearly labeled; an exact production mechanism is no longer required.',
      metadata: { throughSequence: guidance.sequence, derived: true },
    });

    expect(await stores.communication.hasAgentUpdatedWorkingNoteThrough(
      USER_AGENT_ID,
      guidance.sequence,
    )).toBe(true);
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).guidanceFollowThrough)
      .toMatchObject({
        guidance: { sequence: guidance.sequence },
        priorWorkingNote: { sequence: priorNote.sequence },
        workingNote: {
          sequence: revisedNote.sequence,
          content: revisedNote.content,
        },
      });
  });

  it('projects persisted follow-through after the latest feedback', async () => {
    const source = await registerSynthetic(stores, 'follow-through-source');
    await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find product decisions changed by context outside the builder workspace.',
    );
    const firstMessage = await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      title: 'An initial network lead',
      content: 'A builder changed onboarding after one outside conversation.',
    });
    const firstFinding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'An initial finding',
      content: 'An outside conversation may have changed onboarding.',
      metadata: { sourceEventIds: [firstMessage.sequence] },
    });
    const feedback = await stores.workspace.saveFeedback(
      LOCAL_USER_ID,
      firstFinding.sequence,
      'Only continue with a before-and-after decision and named mechanism.',
    );

    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).guidanceFollowThrough)
      .toMatchObject({
        guidance: { sequence: feedback.sequence },
        sourceFinding: { sequence: firstFinding.sequence },
      });

    const note = await stores.communication.appendCommunicationEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a before-and-after decision and named mechanism.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });
    const check = await stores.workspace.recordCheckRequest({
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'You ask Lucid to check now',
      content: 'Continue with the participant feedback.',
      metadata: { latestGuidanceSequence: feedback.sequence },
    });
    const request = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      replyToSequence: check.sequence,
      title: 'Your representative asks a narrower question',
      content: 'Who has a before-and-after decision and named mechanism?',
      metadata: { sourceEventIds: [check.sequence], messageRole: 'request' },
    });
    const sourceInput = await stores.network.saveParticipantInput(
      source.participant.id,
      'A team replaced persona setup with one active problem after support interviews exposed the missing handoff.',
      'test:follow-through:result',
    );
    const response = await stores.communication.appendCommunicationEvent({
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
    const resultingFinding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A later finding',
      content: 'The onboarding decision now includes a concrete mechanism.',
      metadata: { sourceEventIds: [response.sequence] },
    });

    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).guidanceFollowThrough)
      .toMatchObject({
        guidance: { sequence: feedback.sequence, content: feedback.content },
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

    const laterCheck = await stores.workspace.recordCheckRequest({
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'You ask Lucid to check again',
      content: 'Apply the same feedback to a more precise request.',
      metadata: { latestGuidanceSequence: feedback.sequence },
    });
    const laterRequest = await stores.communication.appendCommunicationEvent({
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
    const laterResponse = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: source.agent.id,
      replyToSequence: laterRequest.sequence,
      title: 'A participant answers the more precise request',
      content: 'A participant inbox replaced a global task dashboard.',
      metadata: { sourceEventIds: [], messageRole: 'response' },
    });
    const laterFinding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'A more precise later finding',
      content: 'The global dashboard became a participant inbox.',
      metadata: { sourceEventIds: [laterResponse.sequence] },
    });

    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).guidanceFollowThrough)
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
    await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find one specific participant match.',
    );
    const firstWake = await stores.representative.beginAgentWake(
      USER_AGENT_ID,
      'wake_first',
    );
    expect(firstWake).toBeDefined();

    const firstEvent = await stores.communication.appendCommunicationEvent({
      wakeNumber: firstWake!.wakeNumber,
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      idempotencyKey: `${firstWake!.wakeId}:action:1`,
      title: 'Original action',
      content: 'This is the first durable side effect.',
    });
    const firstNote = await stores.communication.appendCommunicationEvent({
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
    await stores.representative.failAgentWake(
      USER_AGENT_ID,
      firstWake!.claimToken,
    );

    const retriedWake = await stores.representative.beginAgentWake(
      USER_AGENT_ID,
      'wake_replacement',
    );
    expect(retriedWake).toMatchObject({
      wakeId: firstWake!.wakeId,
      wakeNumber: firstWake!.wakeNumber,
      horizonSequence: firstWake!.horizonSequence,
    });
    expect(await stores.workspace.readRepresentativeWorkingContext(
      USER_AGENT_ID,
      retriedWake!.horizonSequence,
    )).toMatchObject({ workingNote: undefined });
    expect(await stores.communication.appendCommunicationEvent({
      wakeNumber: retriedWake!.wakeNumber,
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      idempotencyKey: `${retriedWake!.wakeId}:action:1`,
      title: 'Replacement action',
      content: 'This must not create a second side effect.',
    })).toEqual(firstEvent);
    expect(await stores.communication.appendCommunicationEvent({
      wakeNumber: retriedWake!.wakeNumber,
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      idempotencyKey: `${retriedWake!.wakeId}:working-note`,
      title: 'Replacement working note',
      content: 'This retry must return the first note.',
    })).toEqual(firstNote);
    expect((await stores.network.readNetworkDiagnostics()).events.filter(
      ({ kind }) => kind === 'shared_message',
    )).toHaveLength(1);
  });

  it('recovers only the matching interrupted wake without consuming unread input', async () => {
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Keep this input unread until the wake succeeds.',
    );
    const claimed = await stores.representative.beginAgentWake(
      USER_AGENT_ID,
      'execution_before_restart',
    );
    expect(claimed?.visibleEvents.map(({ sequence }) => sequence))
      .toContain(interest.sequence);

    expect(await stores.representative.recoverInterruptedAgentWake(
      USER_AGENT_ID,
      'different_execution',
    )).toBe(false);
    expect((await stores.workspace.requireParticipantAgent(
      LOCAL_USER_ID,
    )).status).toBe('running');
    expect(await stores.representative.recoverInterruptedAgentWake(
      USER_AGENT_ID,
      claimed!.claimToken,
    )).toBe(true);
    expect(await stores.representative.recoverInterruptedAgentWake(
      USER_AGENT_ID,
      claimed!.claimToken,
    )).toBe(false);

    const resumed = await stores.representative.beginAgentWake(
      USER_AGENT_ID,
      'execution_after_restart',
    );
    expect(resumed).toMatchObject({
      wakeId: claimed!.wakeId,
      wakeNumber: claimed!.wakeNumber,
      horizonSequence: claimed!.horizonSequence,
    });
    expect(resumed?.visibleEvents.map(({ sequence }) => sequence))
      .toContain(interest.sequence);
    expect((await stores.network.readNetworkDiagnostics()).events).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        title: 'Interrupted representative wake recovered',
      }),
    );
  });
});

async function registerSynthetic(
  stores: LucidStoreSet,
  key: string,
) {
  return await stores.network.registerParticipant({
    registrationKey: `sim:test:${key}`,
    kind: 'synthetic',
    displayName: `Synthetic ${key}`,
    privateContext: `Private context for ${key}.`,
  });
}
