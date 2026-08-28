import { describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  AgentWakeClaim,
  DiscoveryEvent,
  DiscoveryWorkspace,
  User,
} from '../discovery-types.js';
import { createLucidLogger } from '../../logger.js';
import type { AgentCommunicationStore } from './communication/store.js';
import type { AgentWakeStore } from './store.js';
import { AgentWorkService } from './work-service.js';

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

  it('settles guidance only after a claim-fenced working-note update', async () => {
    const fixture = createFixture('guidance_saved');
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
  });
});

function createFixture(
  triggerKind: DiscoveryEvent['kind'] = 'check_requested',
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
    kind: triggerKind,
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
    visibleEvents: [trigger],
    horizonSequence: trigger.sequence,
  };
  let activeClaim = false;
  let sharedMessage: DiscoveryEvent | undefined;
  let workingNoteUpdated = false;
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
    recoverInterruptedAgentWake: async () => false,
    findAgentPublishedRequestForTrigger: async () => sharedMessage,
    hasAgentUpdatedWorkingNoteThrough: async () => workingNoteUpdated,
    recordWakeCompletion,
  } satisfies AgentWakeStore;

  const communicationStore = {
    listAgents: async () => [agent],
    listActiveAgents: async () => [agent],
    listEventsVisibleToAgent: async () => [trigger],
    readVisibleEventsBySequence: async (
      _agentId: string,
      sequences: number[],
    ) => sequences.includes(trigger.sequence) ? [trigger] : [],
    countAgentWakeCommunicationActions: async () => (
      sharedMessage ? 1 : 0
    ),
    findAgentPublishedRequestForTrigger: async () => sharedMessage,
    hasAgentUpdatedWorkingNoteThrough: async () => workingNoteUpdated,
    hasUserFindingUsingAnyOrigin: async () => false,
    hasAgentContributedToRequestThread: async () => false,
    appendCommunicationEvent: async (input) => {
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
      return appended;
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
