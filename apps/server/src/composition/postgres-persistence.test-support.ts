import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  LOCAL_USER_ID,
  LOCAL_AGENT_ID,
} from '../lucid/local-user.js';
import {
  LUCID_BACKGROUND_WORK_GROUP_ID,
} from '../lucid/agent/heartbeat-task-identity.js';
import type { UserNetworkStore } from '../lucid/network/store.js';
import type {
  AgentCommunicationStore,
} from '../lucid/agent/communication/store.js';
import type {
  AgentWakeStore,
} from '../lucid/agent/store.js';
import type { DiscoveryWorkspaceStore } from '../lucid/workspace/store.js';

export type LucidStoreSet = {
  workspace: DiscoveryWorkspaceStore;
  network: UserNetworkStore;
  agent: AgentWakeStore;
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

  it('starts with only the local user and returns a scoped product view', async () => {
    const product = await stores.workspace.readSnapshot(LOCAL_USER_ID);
    const diagnostics = await stores.network.readNetworkDiagnostics();

    expect(product.workspace.currentWake).toBe(0);
    expect(product.user).toMatchObject({
      id: LOCAL_USER_ID,
      kind: 'human',
      displayName: 'You',
    });
    expect(product.agent).toMatchObject({
      id: LOCAL_AGENT_ID,
      user: { id: LOCAL_USER_ID },
    });
    expect(diagnostics.users.map(({ id }) => id)).toEqual([
      LOCAL_USER_ID,
    ]);
    expect(diagnostics.agents.map(({ id }) => id)).toEqual([LOCAL_AGENT_ID]);
    expect(JSON.stringify(product)).not.toContain('privateContext');
    expect(JSON.stringify(product)).not.toContain('registrationKey');
    expect(product.agentActivity).toEqual([]);
  });

  it('prepares one retry-stable fresh mailbox boundary before background resume', async () => {
    await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Only inspect information that arrives after background work resumes.',
    );
    await stores.agent.setBackgroundChecksEnabled(false);
    const staleInput = await stores.network.saveUserInput(
      LOCAL_USER_ID,
      'This arrived while background work was paused.',
      'resume-boundary:stale-input',
    );

    expect(await stores.agent.prepareBackgroundChecksResume({
      admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
      transitionId: 'resume-disabled',
    })).toEqual({
      status: 'waiting',
      reason: 'background-checks-disabled',
      runningAgentIds: [],
    });

    await stores.agent.setBackgroundChecksEnabled(true);
    const prepared = await stores.agent.prepareBackgroundChecksResume({
      admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
      transitionId: 'resume-fresh-start',
    });
    expect(prepared).toMatchObject({
      status: 'prepared',
      admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
      transitionId: 'resume-fresh-start',
      agentCount: 1,
    });
    if (prepared.status !== 'prepared') {
      throw new Error('Expected the resume boundary to be prepared.');
    }

    const freshInput = await stores.network.saveUserInput(
      LOCAL_USER_ID,
      'This arrived after background work resumed.',
      'resume-boundary:fresh-input',
    );
    expect(await stores.agent.prepareBackgroundChecksResume({
      admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
      transitionId: 'resume-fresh-start',
    })).toEqual(prepared);

    const wake = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'wake_after_background_resume',
    );
    expect(wake?.visibleEvents.map(({ sequence }) => sequence)).not
      .toContain(staleInput.sequence);
    expect(wake?.visibleEvents.map(({ sequence }) => sequence))
      .toContain(freshInput.sequence);
  });

  it('keeps resume preparation waiting while an Agent wake is running', async () => {
    await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Do not move my mailbox boundary under an active Agent wake.',
    );
    const wake = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'wake_running_during_resume',
    );

    expect(await stores.agent.prepareBackgroundChecksResume({
      admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
      transitionId: 'resume-after-running-wake',
    })).toEqual({
      status: 'waiting',
      reason: 'agent-wake-running',
      runningAgentIds: [LOCAL_AGENT_ID],
    });

    await stores.agent.interruptAgentWake(
      LOCAL_AGENT_ID,
      wake!.claimToken,
    );
    expect(await stores.agent.prepareBackgroundChecksResume({
      admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
      transitionId: 'resume-after-running-wake',
    })).toMatchObject({
      status: 'prepared',
      transitionId: 'resume-after-running-wake',
    });
  });

  it('projects one product-readable Activity item per completed Agent wake', async () => {
    await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find one specific agent collaboration pattern.',
    );
    const wake = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'wake_activity_quiet',
    );
    expect(wake).toBeDefined();
    await stores.communication.appendCommunicationEvent({
      wakeNumber: wake!.wakeNumber,
      kind: 'agent_wake_no_action',
      actorAgentId: LOCAL_AGENT_ID,
      title: 'Internal quiet outcome',
      content: '#1 did not add anything concrete.',
      metadata: { wakeId: wake!.wakeId },
    });
    await stores.agent.recordWakeCompletion({
      wakeNumber: wake!.wakeNumber,
      actorAgentId: LOCAL_AGENT_ID,
      title: 'Internal completion',
      content: 'The wake completed.',
      metadata: { wakeId: wake!.wakeId },
    });
    await stores.agent.completeAgentWake(
      LOCAL_AGENT_ID,
      wake!.claimToken,
      wake!.horizonSequence,
    );

    const [activity] = (await stores.workspace.readSnapshot(
      LOCAL_USER_ID,
    )).agentActivity;
    expect(activity).toMatchObject({
      kind: 'no-new-finding',
      title: 'No new Finding',
      inputCount: 1,
      findingCount: 0,
    });
    expect(JSON.stringify(activity)).not.toContain('#1');
    expect(JSON.stringify(activity)).not.toContain('wake_activity_quiet');
  });

  it('claims later scheduled Interest checks without new mailbox input', async () => {
    await expect(stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'scheduled_without_interest',
    )).resolves.toBeUndefined();

    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find one concrete improvement to durable agent collaboration.',
    );
    const first = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'scheduled_first',
    );
    expect(first?.visibleEvents.map(({ sequence }) => sequence))
      .toEqual([interest.sequence]);
    await stores.communication.appendCommunicationEvent({
      wakeNumber: first!.wakeNumber,
      kind: 'agent_wake_no_action',
      actorAgentId: LOCAL_AGENT_ID,
      title: 'No new Finding',
      content: 'The first Interest check found nothing concrete.',
      metadata: { wakeId: first!.wakeId },
    });
    await stores.agent.recordWakeCompletion({
      wakeNumber: first!.wakeNumber,
      actorAgentId: LOCAL_AGENT_ID,
      title: 'Interest check completed',
      content: 'The first Interest check completed.',
      metadata: { wakeId: first!.wakeId },
    });
    await stores.agent.completeAgentWake(
      LOCAL_AGENT_ID,
      first!.claimToken,
      first!.horizonSequence,
    );

    const second = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'scheduled_second',
    );
    expect(second).toMatchObject({
      wakeNumber: first!.wakeNumber + 1,
      visibleEvents: [],
    });
    expect(second!.horizonSequence).toBeGreaterThan(first!.horizonSequence);
    await stores.communication.appendCommunicationEvent({
      wakeNumber: second!.wakeNumber,
      kind: 'agent_wake_no_action',
      actorAgentId: LOCAL_AGENT_ID,
      title: 'No new Finding',
      content: 'The current world still adds nothing concrete.',
      metadata: { wakeId: second!.wakeId },
    });
    await stores.agent.recordWakeCompletion({
      wakeNumber: second!.wakeNumber,
      actorAgentId: LOCAL_AGENT_ID,
      title: 'Interest check completed',
      content: 'The scheduled Interest check completed.',
      metadata: { wakeId: second!.wakeId },
    });
    await stores.agent.completeAgentWake(
      LOCAL_AGENT_ID,
      second!.claimToken,
      second!.horizonSequence,
    );

    expect((await stores.workspace.readSnapshot(
      LOCAL_USER_ID,
    )).agentActivity.slice(0, 2)).toMatchObject([
      { kind: 'no-new-finding', inputCount: 0 },
      { kind: 'no-new-finding', inputCount: 1 },
    ]);
  });

  it('registers independent users idempotently without exposing private context', async () => {
    const input = {
      registrationKey: 'sim:test:builder',
      kind: 'synthetic' as const,
      displayName: 'Independent builder',
      privateContext: 'Private observations from small product experiments.',
    };

    const first = await stores.network.registerUser(input);
    const second = await stores.network.registerUser(input);
    const diagnostics = await stores.network.readNetworkDiagnostics();

    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      user: { id: first.user.id },
      agent: { id: first.agent.id },
    });
    expect(diagnostics.users).toHaveLength(2);
    expect(diagnostics.agents).toHaveLength(2);
    expect(JSON.stringify(diagnostics)).not.toContain(input.privateContext);
    await expect(stores.network.registerUser({
      ...input,
      privateContext: 'A conflicting identity payload.',
    })).rejects.toThrow('already belongs to a different user profile');
  });

  it('delivers each user input only to its own agent', async () => {
    const source = await registerSynthetic(stores, 'source');
    const event = await stores.network.saveUserInput(
      source.user.id,
      'One new observation arrived from this user.',
      'sim-input:source:1',
    );

    expect(
      (await stores.communication.listEventsVisibleToAgent(source.agent.id, 0))
        .map(({ sequence }) => sequence),
    ).toContain(event.sequence);
    expect(
      (await stores.communication.listEventsVisibleToAgent(LOCAL_AGENT_ID, 0))
        .map(({ sequence }) => sequence),
    ).not.toContain(event.sequence);
    expect(await stores.network.saveUserInput(
      source.user.id,
      'A retry must return the original event.',
      'sim-input:source:1',
    )).toEqual(event);
    await expect(stores.agent.beginAgentWake(
      source.agent.id,
      'mailbox_without_interest',
    )).resolves.toMatchObject({
      visibleEvents: [{ sequence: event.sequence, kind: 'user_input' }],
    });
  });

  it('enforces consent and mailbox floors across a human user lifecycle', async () => {
    const historicalMessage = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      title: 'Message from before the user joined',
      content: 'A new user must not inherit this old message.',
    });
    const privateContext = 'I approved one specific personal observation.';
    const created = await stores.network.registerUser({
      registrationKey: 'human:test:avery',
      kind: 'human',
      displayName: 'Avery',
      privateContext,
      contextApproved: true,
    });

    expect(created.user.contextConsentAt).toEqual(expect.any(String));
    expect(await stores.communication.listEventsVisibleToAgent(created.agent.id, 0))
      .not.toContainEqual(expect.objectContaining({
        sequence: historicalMessage.sequence,
      }));
    expect(JSON.stringify(await stores.network.readNetworkDiagnostics()))
      .not.toContain(privateContext);

    await stores.network.setUserStatus(created.user.id, 'disabled');
    const pausedMessage = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      title: 'Message sent while paused',
      content: 'This message must not be replayed after resume.',
    });
    await stores.network.setUserStatus(created.user.id, 'active');
    expect(await stores.communication.readVisibleEventsBySequence(
      created.agent.id,
      [pausedMessage.sequence],
    )).toEqual([]);

    const retired = await stores.network.retireUser(created.user.id);
    expect(retired.user).toMatchObject({
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
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Specific response',
      content: 'A user supplied one relevant observation.',
    });
    await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
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
          userId: source.user.id,
          userDisplayName: source.user.displayName,
          userKind: 'synthetic',
        }),
      })],
    });
    expect(snapshot.findings[0]?.assignmentSequence).toBeUndefined();
    expect(snapshot).not.toHaveProperty('agents');
    expect(snapshot).not.toHaveProperty('events');
  });

  it('limits genuine findings after excluding legacy quiet checks', async () => {
    const source = await registerSynthetic(stores, 'finding-limit-source');
    const sourceMessage = await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'A genuine network contribution',
      content: 'A durable agent kept its product memory outside the execution host.',
    });
    const genuineFinding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'A genuine older finding',
      content: 'Durable product memory can remain independent of execution.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });

    await Promise.all(Array.from({ length: 12 }, async (_, index) => (
      await stores.communication.appendCommunicationEvent({
        kind: 'finding_reported',
        actorAgentId: LOCAL_AGENT_ID,
        targetUserId: LOCAL_USER_ID,
        title: `Legacy quiet check ${index + 1}`,
        content: 'No relevant network contribution surfaced.',
        metadata: { noMatch: true, sourceEventIds: [] },
      })
    )));

    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).findings)
      .toEqual([
        expect.objectContaining({
          finding: expect.objectContaining({
            sequence: genuineFinding.sequence,
          }),
          noMatch: false,
        }),
      ]);
  });

  it('projects the latest user-owned network request lifecycle', async () => {
    const source = await registerSynthetic(stores, 'request-source');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find a concrete example of long-running agent memory.',
    );

    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).networkActivity).toEqual({
      assignment: interest,
      previousRequests: [],
    });

    const request = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'Your agent asks the network',
      content: 'Who has observed a concrete long-running memory failure?',
      metadata: { sourceEventIds: [interest.sequence] },
    });
    expect(await stores.communication.findAgentPublishedRequestForTrigger(
      LOCAL_AGENT_ID,
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
      targetAgentId: LOCAL_AGENT_ID,
      replyToSequence: request.sequence,
      title: 'A user replies',
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
        originatingUserCount: 1,
        latestResponseAt: response.createdAt,
      },
    });

    const responseWake = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'wake_review_response',
    );
    expect(responseWake).toBeDefined();
    const reviewCompletion = await stores.agent.recordWakeCompletion({
      wakeNumber: responseWake!.wakeNumber,
      actorAgentId: LOCAL_AGENT_ID,
      title: 'The agent completes response review',
      content: 'The delivered response was processed.',
      metadata: { wakeId: responseWake!.wakeId },
    });
    await stores.agent.completeAgentWake(
      LOCAL_AGENT_ID,
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
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
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
        originatingUserCount: 1,
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
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
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
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: check.sequence,
      title: 'Your agent checks the network again',
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
      'Find durable examples of user-controlled agent work.',
    );
    const firstRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'The first request',
      content: 'Who has a user-controlled agent example?',
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
    const responseWake = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'wake_history_silence',
    );
    await stores.agent.recordWakeCompletion({
      wakeNumber: responseWake!.wakeNumber,
      actorAgentId: LOCAL_AGENT_ID,
      title: 'Review finishes without a finding',
      content: 'The response did not satisfy the assignment.',
      metadata: { wakeId: responseWake!.wakeId },
    });
    await stores.agent.completeAgentWake(
      LOCAL_AGENT_ID,
      responseWake!.claimToken,
      responseWake!.horizonSequence,
    );

    const guidance = await stores.workspace.saveGuidance(
      LOCAL_USER_ID,
      'Only keep independently named examples with a user-visible result.',
    );
    const guidedCheck = await stores.workspace.recordCheckRequest({
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Apply the newer guidance',
      content: 'Look again using the user correction.',
      metadata: { latestGuidanceSequence: guidance.sequence },
    });
    const guidedRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: guidedCheck.sequence,
      title: 'A guidance-shaped request',
      content: 'Who has an independently named example with a visible result?',
      metadata: { sourceEventIds: [guidedCheck.sequence] },
    });
    const latestCheck = await stores.workspace.recordCheckRequest({
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Start one newer check',
      content: 'Look for a newer increment.',
    });
    const latestRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
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
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'Initial request',
      content: 'Start the bounded history.',
      metadata: { sourceEventIds: [interest.sequence] },
    })];

    for (let index = 1; index <= 6; index += 1) {
      const check = await stores.workspace.recordCheckRequest({
        targetAgentId: LOCAL_AGENT_ID,
        targetUserId: LOCAL_USER_ID,
        title: `Check ${index}`,
        content: `Look for increment ${index}.`,
      });
      requests.push(await stores.communication.appendCommunicationEvent({
        kind: 'shared_message',
        actorAgentId: LOCAL_AGENT_ID,
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
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'The canonical request',
      content: 'Who has one concrete example?',
      metadata: { sourceEventIds: [interest.sequence] },
    });
    const duplicateRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
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
    const responseWake = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'wake_duplicate_request_review',
    );
    await stores.communication.appendCommunicationEvent({
      wakeNumber: responseWake!.wakeNumber,
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'A linked finding',
      content: 'A durable mailbox makes completed silence legible.',
      metadata: { sourceEventIds: [canonicalResponse.sequence] },
    });
    await stores.agent.recordWakeCompletion({
      wakeNumber: responseWake!.wakeNumber,
      actorAgentId: LOCAL_AGENT_ID,
      title: 'The agent completes review',
      content: 'Every delivered response was reviewed.',
      metadata: { wakeId: responseWake!.wakeId },
    });
    await stores.agent.completeAgentWake(
      LOCAL_AGENT_ID,
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

  it('collapses relays into their originating user contribution', async () => {
    const origin = await registerSynthetic(stores, 'origin');
    const relay = await registerSynthetic(stores, 'relay');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find a concrete operator workflow for long-running agents.',
    );
    const request = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'Your agent asks the network',
      content: 'Who has a concrete long-running operator workflow?',
      metadata: {
        messageRole: 'request',
        sourceEventIds: [interest.sequence],
      },
    });
    const originInput = await stores.network.saveUserInput(
      origin.user.id,
      'A support operator keeps unresolved cases across daily agent wakes.',
      'test:origin:workflow',
    );
    const originResponse = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: origin.agent.id,
      replyToSequence: request.sequence,
      title: 'An originating user responds',
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
      title: 'Another agent relays the response',
      content: `From #${originResponse.sequence}: ${originResponse.content}`,
      metadata: {
        messageRole: 'response',
        sourceEventIds: [originResponse.sequence],
      },
    });
    await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
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
        originatingUserCount: 1,
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
          userId: origin.user.id,
        }),
      })],
    });
    expect(await stores.communication.hasUserFindingUsingAnyOrigin(
      LOCAL_USER_ID,
      [relayedResponse.sequence],
    )).toBe(true);
  });

  it('projects user-scoped working history at a retry-stable event horizon', async () => {
    const source = await registerSynthetic(stores, 'memory-source');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find products that preserve useful unfinished work.',
    );
    const firstNote = await stores.communication.appendCommunicationEvent({
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Look for concrete examples involving unfinished work.',
      metadata: { throughSequence: interest.sequence, derived: true },
    });
    const sourceMessage = await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: LOCAL_AGENT_ID,
      title: 'A concrete network observation',
      content: 'A prototype retained abandoned drafts for later comparison.',
    });
    const finding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
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
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a named workflow before reporting similar examples.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });

    const beforeRevision = await stores.workspace.readAgentWorkingContext(
      LOCAL_AGENT_ID,
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

    const afterRevision = await stores.workspace.readAgentWorkingContext(
      LOCAL_AGENT_ID,
      revisedNote.sequence,
    );
    expect(afterRevision.workingNote).toMatchObject({
      sequence: revisedNote.sequence,
      content: 'Require a named workflow before reporting similar examples.',
    });
    expect((await stores.workspace.readSnapshot(LOCAL_USER_ID)).workingNote).toEqual(
      revisedNote,
    );
    expect(await stores.workspace.readAgentWorkingContext(
      source.agent.id,
      revisedNote.sequence,
    )).toMatchObject({
      principalInputs: [],
      findings: [],
      workingNote: undefined,
    });
  });

  it('keeps direct guidance private and traces the agent revision', async () => {
    const peer = await registerSynthetic(stores, 'guidance-peer');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find early signals about durable personal agents.',
    );
    const priorNote = await stores.communication.appendCommunicationEvent({
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require an exact production mechanism before reporting.',
      metadata: { throughSequence: interest.sequence, derived: true },
    });
    const guidance = await stores.workspace.saveGuidance(
      LOCAL_USER_ID,
      'Weak signals are useful again, but label them clearly.',
    );

    expect(await stores.communication.listEventsVisibleToAgent(
      LOCAL_AGENT_ID,
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
    expect((await stores.workspace.readAgentWorkingContext(
      LOCAL_AGENT_ID,
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
      LOCAL_AGENT_ID,
      guidance.sequence,
    )).toBe(false);

    const revisedNote = await stores.communication.appendCommunicationEvent({
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content:
        'Accept weak signals when they are clearly labeled; an exact production mechanism is no longer required.',
      metadata: { throughSequence: guidance.sequence, derived: true },
    });

    expect(await stores.communication.hasAgentUpdatedWorkingNoteThrough(
      LOCAL_AGENT_ID,
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
      targetAgentId: LOCAL_AGENT_ID,
      title: 'An initial network lead',
      content: 'A builder changed onboarding after one outside conversation.',
    });
    const firstFinding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
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
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a before-and-after decision and named mechanism.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });
    const check = await stores.workspace.recordCheckRequest({
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'You ask Lucid to check now',
      content: 'Continue with the user feedback.',
      metadata: { latestGuidanceSequence: feedback.sequence },
    });
    const request = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: check.sequence,
      title: 'Your agent asks a narrower question',
      content: 'Who has a before-and-after decision and named mechanism?',
      metadata: { sourceEventIds: [check.sequence], messageRole: 'request' },
    });
    const sourceInput = await stores.network.saveUserInput(
      source.user.id,
      'A team replaced persona setup with one active problem after support interviews exposed the missing handoff.',
      'test:follow-through:result',
    );
    const response = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: source.agent.id,
      replyToSequence: request.sequence,
      title: 'A user answers the narrower request',
      content: sourceInput.content,
      metadata: {
        sourceEventIds: [sourceInput.sequence],
        messageRole: 'response',
      },
    });
    const resultingFinding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
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
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'You ask Lucid to check again',
      content: 'Apply the same feedback to a more precise request.',
      metadata: { latestGuidanceSequence: feedback.sequence },
    });
    const laterRequest = await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: laterCheck.sequence,
      title: 'Your agent asks a more precise question',
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
      title: 'A user answers the more precise request',
      content: 'A user inbox replaced a global task dashboard.',
      metadata: { sourceEventIds: [], messageRole: 'response' },
    });
    const laterFinding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'A more precise later finding',
      content: 'The global dashboard became a user inbox.',
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
      'Find one specific user match.',
    );
    const firstWake = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'wake_first',
    );
    expect(firstWake).toBeDefined();

    const firstEvent = await stores.communication.appendCommunicationEvent({
      wakeNumber: firstWake!.wakeNumber,
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      idempotencyKey: `${firstWake!.wakeId}:action:1`,
      title: 'Original action',
      content: 'This is the first durable side effect.',
    });
    const firstNote = await stores.communication.appendCommunicationEvent({
      wakeNumber: firstWake!.wakeNumber,
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      idempotencyKey: `${firstWake!.wakeId}:working-note`,
      title: 'Original working note',
      content: 'This note was written by the first attempt.',
      metadata: { throughSequence: firstWake!.horizonSequence },
    });
    await stores.agent.failAgentWake(
      LOCAL_AGENT_ID,
      firstWake!.claimToken,
    );

    const retriedWake = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'wake_replacement',
    );
    expect(retriedWake).toMatchObject({
      wakeId: firstWake!.wakeId,
      wakeNumber: firstWake!.wakeNumber,
      horizonSequence: firstWake!.horizonSequence,
    });
    expect(await stores.agent.readClaimedAgentWake(
      LOCAL_AGENT_ID,
      firstWake!.claimToken,
    )).toBeUndefined();
    expect(await stores.agent.readClaimedAgentWake(
      LOCAL_AGENT_ID,
      retriedWake!.claimToken,
    )).toMatchObject({
      wakeId: retriedWake!.wakeId,
      claimToken: retriedWake!.claimToken,
      horizonSequence: retriedWake!.horizonSequence,
      visibleEvents: retriedWake!.visibleEvents,
    });
    expect(await stores.workspace.readAgentWorkingContext(
      LOCAL_AGENT_ID,
      retriedWake!.horizonSequence,
    )).toMatchObject({ workingNote: undefined });
    expect(await stores.communication.appendCommunicationEvent({
      wakeNumber: retriedWake!.wakeNumber,
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      idempotencyKey: `${retriedWake!.wakeId}:action:1`,
      title: 'Replacement action',
      content: 'This must not create a second side effect.',
    })).toEqual(firstEvent);
    expect(await stores.communication.appendCommunicationEvent({
      wakeNumber: retriedWake!.wakeNumber,
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
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
    const claimed = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'execution_before_restart',
    );
    expect(claimed?.visibleEvents.map(({ sequence }) => sequence))
      .toContain(interest.sequence);

    expect(await stores.agent.recoverInterruptedAgentWake(
      LOCAL_AGENT_ID,
      'different_execution',
    )).toBe(false);
    expect((await stores.workspace.requireAgentForUser(
      LOCAL_USER_ID,
    )).status).toBe('running');
    expect(await stores.agent.recoverInterruptedAgentWake(
      LOCAL_AGENT_ID,
      claimed!.claimToken,
    )).toBe(true);
    expect(await stores.agent.recoverInterruptedAgentWake(
      LOCAL_AGENT_ID,
      claimed!.claimToken,
    )).toBe(false);

    const resumed = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
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
        title: 'Interrupted agent wake recovered',
      }),
    );
  });
});

async function registerSynthetic(
  stores: LucidStoreSet,
  key: string,
) {
  return await stores.network.registerUser({
    registrationKey: `sim:test:${key}`,
    kind: 'synthetic',
    displayName: `Synthetic ${key}`,
    privateContext: `Private context for ${key}.`,
  });
}
