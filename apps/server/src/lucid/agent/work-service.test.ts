import { describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  AgentWakeClaim,
  DiscoveryEvent,
  DiscoveryWorkspace,
  User,
} from '../discovery-types.js';
import { createLucidLogger } from '../../logger.js';
import {
  AgentCommunicationClaimError,
  type AgentCommunicationStore,
  type AppendCommunicationEventInput,
} from './communication/store.js';
import type { AgentWakeStore } from './store.js';
import {
  AgentWorkService,
  READ_AGENT_WORKING_CONTEXT_TOOL,
} from './work-service.js';

describe('AgentWorkService', () => {
  it('claims, mutates, validates, and commits one product work horizon', async () => {
    const fixture = createFixture();
    const triggerAgent = vi.fn(async () => undefined);
    const service = new AgentWorkService(
      fixture.workStore,
      {
        readAgentWorkingContext: async () => ({
          principalInputs: [fixture.trigger],
          findings: [],
        }),
      },
      fixture.communicationStore,
      { triggerAgent },
      createLucidLogger('silent'),
      { retryDelayMs: 10_000 },
    );
    const signal = new AbortController().signal;

    await expect(service.claimWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      signal,
    })).resolves.toMatchObject({
      kind: 'claimed',
      work: {
        workId: 'work-1',
        executionId: 'execution-1',
        horizonSequence: fixture.trigger.sequence,
      },
    });

    await expect(service.executeTool({
      userId: fixture.user.id,
      executionId: 'execution-1',
      toolName: 'read_available_messages',
      arguments: {},
      signal,
    })).resolves.toMatchObject({ ok: true });
    await expect(service.executeTool({
      userId: fixture.user.id,
      executionId: 'execution-1',
      toolName: READ_AGENT_WORKING_CONTEXT_TOOL,
      arguments: {},
      signal,
    })).resolves.toEqual({
      ok: true,
      output: {
        principalInputs: [fixture.trigger],
        findings: [],
      },
    });
    await expect(service.executeTool({
      userId: fixture.user.id,
      executionId: 'execution-1',
      toolName: 'post_shared_message',
      arguments: {
        reply_to_event_id: fixture.trigger.sequence,
        content: 'Who has a concrete example matching these constraints?',
        source_event_ids: [fixture.trigger.sequence],
      },
      signal,
    })).resolves.toMatchObject({ ok: true });

    await expect(service.completeWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      result: {
        decision: 'complete',
        summary: 'Published the required request.',
        runId: 'run-1',
        outcome: 'done',
      },
      signal,
    })).resolves.toEqual({ kind: 'accepted' });
    expect(fixture.completeAgentWake).toHaveBeenCalledWith(
      fixture.agent.id,
      'execution-1',
      fixture.trigger.sequence,
    );
    expect(fixture.recordWakeCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'work-1:completed',
        metadata: expect.objectContaining({
          workId: 'work-1',
          executionId: 'execution-1',
        }),
      }),
    );
    expect(triggerAgent).not.toHaveBeenCalled();
  });

  it('rejects agent completion when the required product effect is absent', async () => {
    const fixture = createFixture();
    const service = new AgentWorkService(
      fixture.workStore,
      {
        readAgentWorkingContext: async () => ({
          principalInputs: [],
          findings: [],
        }),
      },
      fixture.communicationStore,
      { triggerAgent: async () => undefined },
      createLucidLogger('silent'),
      { retryDelayMs: 10_000 },
    );
    const signal = new AbortController().signal;
    await service.claimWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      signal,
    });

    await expect(service.completeWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      result: {
        decision: 'complete',
        summary: 'Finished without a product action.',
        runId: 'run-1',
        outcome: 'done',
      },
      signal,
    })).resolves.toEqual({
      kind: 'retry',
      summary: 'The agent finished without sharing the required network request.',
      delayMs: 10_000,
    });
    expect(fixture.failAgentWake).toHaveBeenCalledWith(
      fixture.agent.id,
      'execution-1',
    );
    expect(fixture.completeAgentWake).not.toHaveBeenCalled();
  });

  it.each(['guidance_saved', 'feedback_saved'] as const)(
    'settles %s only after a claim-fenced working-note update',
    async (kind) => {
      const fixture = createFixture(kind);
      const service = new AgentWorkService(
        fixture.workStore,
        {
          readAgentWorkingContext: async () => ({
            principalInputs: [],
            findings: [],
          }),
        },
        fixture.communicationStore,
        { triggerAgent: async () => undefined },
        createLucidLogger('silent'),
        { retryDelayMs: 10_000 },
      );
      const signal = new AbortController().signal;
      await service.claimWork({
        agentId: fixture.agent.id,
        executionId: 'execution-1',
        signal,
      });

      await expect(service.executeTool({
        userId: fixture.user.id,
        executionId: 'execution-1',
        toolName: 'update_working_note',
        arguments: {
          content: 'Prioritize examples that satisfy the latest guidance.',
        },
        signal,
      })).resolves.toMatchObject({ ok: true });
      await expect(service.completeWork({
        agentId: fixture.agent.id,
        executionId: 'execution-1',
        result: {
          decision: 'complete',
          summary: 'Updated the durable working context.',
          runId: 'run-1',
          outcome: 'done',
        },
        signal,
      })).resolves.toEqual({ kind: 'accepted' });
      expect(fixture.completeAgentWake).toHaveBeenCalledWith(
        fixture.agent.id,
        'execution-1',
        fixture.trigger.sequence,
      );
    },
  );

  it('retains user input until the agent records a disposition', async () => {
    const fixture = createFixture('user_input');
    const service = new AgentWorkService(
      fixture.workStore,
      { readAgentWorkingContext: async () => ({ principalInputs: [], findings: [] }) },
      fixture.communicationStore,
      { triggerAgent: async () => undefined },
      createLucidLogger('silent'),
      { retryDelayMs: 10_000 },
    );
    const signal = new AbortController().signal;
    await service.claimWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      signal,
    });

    await expect(service.completeWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      result: {
        decision: 'complete',
        summary: 'Returned without handling the input.',
        runId: 'run-1',
        outcome: 'done',
      },
      signal,
    })).resolves.toEqual({
      kind: 'retry',
      summary:
        'The agent finished without recording an action or an explicit no-action decision for the claimed messages.',
      delayMs: 10_000,
    });
    expect(fixture.completeAgentWake).not.toHaveBeenCalled();
  });

  it('settles user input after an explicit no-action decision', async () => {
    const fixture = createFixture('user_input');
    const service = new AgentWorkService(
      fixture.workStore,
      { readAgentWorkingContext: async () => ({ principalInputs: [], findings: [] }) },
      fixture.communicationStore,
      { triggerAgent: async () => undefined },
      createLucidLogger('silent'),
      { retryDelayMs: 10_000 },
    );
    const signal = new AbortController().signal;
    await service.claimWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      signal,
    });
    await expect(service.executeTool({
      userId: fixture.user.id,
      executionId: 'execution-1',
      toolName: 'read_open_requests',
      arguments: {},
      signal,
    })).resolves.toMatchObject({ ok: true });
    await expect(service.executeTool({
      userId: fixture.user.id,
      executionId: 'execution-1',
      toolName: 'finish_without_action',
      arguments: { reason: 'No current peer request matches this input.' },
      signal,
    })).resolves.toMatchObject({ ok: true });

    await expect(service.completeWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      result: {
        decision: 'complete',
        summary: 'No matching request was available.',
        runId: 'run-1',
        outcome: 'done',
      },
      signal,
    })).resolves.toEqual({ kind: 'accepted' });
  });

  it('runs a scheduled Interest check without new mailbox input', async () => {
    const fixture = createFixture(null);
    const service = new AgentWorkService(
      fixture.workStore,
      {
        readAgentWorkingContext: async () => ({
          principalInputs: [fixture.trigger],
          findings: [],
        }),
      },
      fixture.communicationStore,
      { triggerAgent: async () => undefined },
      createLucidLogger('silent'),
      { retryDelayMs: 10_000 },
    );
    const signal = new AbortController().signal;

    await expect(service.claimWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      signal,
    })).resolves.toMatchObject({
      kind: 'claimed',
      work: {
        visibleEvents: [],
        workingContext: {
          principalInputs: [fixture.trigger],
        },
      },
    });
    await expect(service.executeTool({
      userId: fixture.user.id,
      executionId: 'execution-1',
      toolName: 'finish_without_action',
      arguments: {
        reason: 'The current world adds no concrete Finding to the saved Interest.',
      },
      signal,
    })).resolves.toMatchObject({ ok: true });

    await expect(service.completeWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      result: {
        decision: 'complete',
        summary: 'Checked the current Interest and found nothing new.',
        runId: 'run-1',
        outcome: 'done',
      },
      signal,
    })).resolves.toEqual({ kind: 'accepted' });
    expect(fixture.completeAgentWake).toHaveBeenCalledWith(
      fixture.agent.id,
      'execution-1',
      fixture.trigger.sequence,
    );
  });

  it('retains an empty-mailbox Interest check until it has a disposition', async () => {
    const fixture = createFixture(null);
    const service = new AgentWorkService(
      fixture.workStore,
      { readAgentWorkingContext: async () => ({ principalInputs: [], findings: [] }) },
      fixture.communicationStore,
      { triggerAgent: async () => undefined },
      createLucidLogger('silent'),
      { retryDelayMs: 10_000 },
    );
    const signal = new AbortController().signal;
    await service.claimWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      signal,
    });

    await expect(service.completeWork({
      agentId: fixture.agent.id,
      executionId: 'execution-1',
      result: {
        decision: 'complete',
        summary: 'Returned without a product disposition.',
        runId: 'run-1',
        outcome: 'done',
      },
      signal,
    })).resolves.toEqual({
      kind: 'retry',
      summary:
        'The scheduled Interest check finished without recording a Finding, communication, or an explicit no-finding decision.',
      delayMs: 10_000,
    });
    expect(fixture.completeAgentWake).not.toHaveBeenCalled();
  });
});

function createFixture(
  triggerKind: DiscoveryEvent['kind'] | null = 'check_requested',
) {
  const timestamp = '2026-08-28T00:00:00.000Z';
  const workspace: DiscoveryWorkspace = {
    id: 'workspace-1',
    versionId: 'workspace-v1',
    currentWake: 1,
    backgroundChecksEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const user: User = {
    id: 'user-1',
    workspaceId: workspace.id,
    kind: 'human',
    status: 'active',
    displayName: 'User',
    privateContext: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const agent: Agent = {
    id: 'agent-1',
    workspaceId: workspace.id,
    userId: user.id,
    sortOrder: 0,
    name: 'Agent',
    role: 'representative',
    color: 'green',
    purpose: 'Represent the user',
    instructions: '',
    status: 'running',
    runCount: 1,
    mailboxFloorSequence: 0,
    lastSeenSequence: 0,
    activeWakeId: 'work-1',
    activeWakeClaimToken: 'execution-1',
    activeWakeNumber: 1,
    activeWakeHorizon: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const trigger = event({
    sequence: 1,
    kind: triggerKind ?? 'interest_saved',
    targetAgentId: agent.id,
    targetUserId: user.id,
    title: 'Check now',
    content: 'Find one concrete example.',
  });
  const claim: AgentWakeClaim = {
    agent,
    user,
    wakeId: 'work-1',
    claimToken: 'execution-1',
    wakeNumber: 1,
    visibleEvents: triggerKind ? [trigger] : [],
    horizonSequence: trigger.sequence,
  };
  let activeClaim = false;
  let sharedMessage: DiscoveryEvent | undefined;
  let workingNoteUpdated = false;
  const communicationActions: DiscoveryEvent[] = [];
  const completeAgentWake = vi.fn(async () => {
    activeClaim = false;
  });
  const failAgentWake = vi.fn(async () => undefined);
  const recordWakeCompletion = vi.fn(async () => event({
    sequence: 3,
    kind: 'agent_wake_completed',
    actorAgentId: agent.id,
    title: 'Completed',
    content: 'Completed.',
  }));

  const workStore = {
    reset: async () => undefined,
    readWorkspace: async () => workspace,
    setBackgroundChecksEnabled: async () => workspace,
    prepareBackgroundChecksResume: async ({
      admissionGroupId,
      transitionId,
    }) => ({
      status: 'prepared' as const,
      admissionGroupId,
      transitionId,
      mailboxFloorSequence: 0,
      agentCount: 1,
      preparedAt: '2026-01-01T00:00:00.000Z',
    }),
    listUsers: async () => [user],
    listAgents: async () => [agent],
    listActiveAgents: async () => [agent],
    readEvent: async (sequence: number) => (
      sequence === trigger.sequence ? trigger : undefined
    ),
    listAgentWakeCommunicationEvents: async () => (
      sharedMessage ? [sharedMessage] : []
    ),
    beginAgentWake: async () => {
      activeClaim = true;
      return claim;
    },
    readClaimedAgentWake: async (_agentId: string, token: string) => (
      activeClaim && token === claim.claimToken ? claim : undefined
    ),
    completeAgentWake,
    failAgentWake,
    interruptAgentWake: async () => undefined,
    findAgentPublishedRequestForTrigger: async () => sharedMessage,
    hasAgentUpdatedWorkingNoteThrough: async () => workingNoteUpdated,
    recordWakeCompletion,
  } satisfies AgentWakeStore;

  const appendCommunication = (
    input: AppendCommunicationEventInput,
  ): DiscoveryEvent => {
    const appended = event({
      sequence: 2,
      kind: input.kind,
      actorAgentId: input.actorAgentId,
      targetAgentId: input.targetAgentId,
      targetUserId: input.targetUserId,
      replyToSequence: input.replyToSequence,
      idempotencyKey: input.idempotencyKey,
      title: input.title,
      content: input.content,
      metadata: input.metadata,
    });
    if (input.kind === 'shared_message') {
      sharedMessage = appended;
    }
    if (input.kind === 'agent_note_updated') {
      workingNoteUpdated = true;
    }
    if (
      input.kind === 'shared_message'
      || input.kind === 'direct_message'
      || input.kind === 'finding_reported'
      || input.kind === 'agent_wake_no_action'
    ) {
      communicationActions.push(appended);
    }
    return appended;
  };

  const communicationStore = {
    listAgents: async () => [agent],
    listActiveAgents: async () => [agent],
    listEventsVisibleToAgent: async () => triggerKind ? [trigger] : [],
    readVisibleEventsBySequence: async (
      _agentId: string,
      sequences: number[],
    ) => triggerKind && sequences.includes(trigger.sequence) ? [trigger] : [],
    countAgentWakeCommunicationActions: async () => communicationActions.length,
    findAgentPublishedRequestForTrigger: async () => sharedMessage,
    hasAgentUpdatedWorkingNoteThrough: async () => workingNoteUpdated,
    hasUserFindingUsingAnyOrigin: async () => false,
    hasAgentContributedToRequestThread: async () => false,
    appendCommunicationEvent: async (input) => appendCommunication(input),
    appendClaimedCommunicationEvent: async (ownedClaim, input) => {
      if (
        !activeClaim
        || ownedClaim.agentId !== agent.id
        || ownedClaim.workId !== claim.wakeId
        || ownedClaim.executionId !== claim.claimToken
        || ownedClaim.workNumber !== claim.wakeNumber
      ) {
        throw new AgentCommunicationClaimError();
      }
      return appendCommunication(input);
    },
  } satisfies AgentCommunicationStore;

  return {
    agent,
    user,
    trigger,
    workStore,
    communicationStore,
    completeAgentWake,
    failAgentWake,
    recordWakeCompletion,
  };
}

function event(
  input: Pick<DiscoveryEvent, 'sequence' | 'kind' | 'title' | 'content'>
    & Partial<DiscoveryEvent>,
): DiscoveryEvent {
  return {
    id: `event-${input.sequence}`,
    workspaceId: 'workspace-1',
    wakeNumber: 1,
    metadata: {},
    createdAt: '2026-08-28T00:00:00.000Z',
    ...input,
  };
}
