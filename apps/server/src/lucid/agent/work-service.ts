/**
 * Product-owned durable work lifecycle for one Coordinator execution.
 *
 * The Coordinator owns when an attempt runs. Lucid atomically fixes the
 * mailbox horizon, exposes only that claim to scoped tools, and advances the
 * product cursor only after all required product effects exist.
 */
import { Mutex } from 'async-mutex';
import type { ToolResult } from '@heddleagent/runtime';
import {
  networkMessageRoleSchema,
  type AgentWakeClaim,
  type AgentWorkClaim,
} from '../discovery-types.js';
import type { LucidLogger } from '../../logger.js';
import type { AgentWorkingContextReader } from '../workspace/store.js';
import {
  AgentCommunicationToolService,
  type AgentWorkCommunicationToolName,
} from './communication/tool-service.js';
import type { AgentCommunicationStore } from './communication/store.js';
import type { AgentWakeStore } from './store.js';

export type AgentWorkResult = {
  decision: 'continue' | 'pause' | 'complete' | 'escalate';
  summary: string;
  runId: string;
  outcome: 'done' | 'max_steps' | 'error' | 'interrupted';
};

export type AgentWorkPreparation =
  | { kind: 'claimed'; work: AgentWorkClaim }
  | { kind: 'skipped'; summary: string };

export type AgentWorkDisposition =
  | { kind: 'accepted' }
  | { kind: 'retry'; summary: string; delayMs: number };

export type AgentWorkServiceConfig = {
  retryDelayMs: number;
};

export interface AgentWorkTrigger {
  triggerAgent(agentId: string): Promise<void>;
}

export class AgentWorkClaimError extends Error {
  readonly name = 'AgentWorkClaimError';

  constructor() {
    super('No active Lucid work is owned by this execution.');
  }
}

/** Owns Lucid claim, tool, validation, and product settlement semantics. */
export class AgentWorkService {
  readonly #settlement = new Mutex();

  constructor(
    private readonly store: AgentWakeStore,
    private readonly workingContext: AgentWorkingContextReader,
    private readonly communication: AgentCommunicationStore,
    private readonly trigger: AgentWorkTrigger,
    private readonly logger: LucidLogger,
    private readonly config: Readonly<AgentWorkServiceConfig>,
  ) {}

  async claimWork(input: {
    agentId: string;
    executionId: string;
    interruptedExecutionId?: string;
    signal: AbortSignal;
  }): Promise<AgentWorkPreparation> {
    input.signal.throwIfAborted();
    if (!(await this.store.readWorkspace()).backgroundChecksEnabled) {
      return { kind: 'skipped', summary: 'Background checks are paused.' };
    }
    if (input.interruptedExecutionId) {
      await this.store.recoverInterruptedAgentWake(
        input.agentId,
        input.interruptedExecutionId,
      );
    }
    const claim = await this.store.beginAgentWake(
      input.agentId,
      input.executionId,
    );
    input.signal.throwIfAborted();
    return claim
      ? { kind: 'claimed', work: await this.#toWorkClaim(claim) }
      : {
          kind: 'skipped',
          summary: 'No unread messages were available for this agent.',
        };
  }

  async executeTool(input: {
    userId: string;
    executionId: string;
    toolName: AgentWorkCommunicationToolName;
    arguments: unknown;
    signal: AbortSignal;
  }): Promise<ToolResult> {
    input.signal.throwIfAborted();
    const work = await this.#readWorkForUser(
      input.userId,
      input.executionId,
    );
    if (!work) {
      throw new AgentWorkClaimError();
    }
    const requiredRequestSourceIds = work.visibleEvents
      .filter(({ kind }) => (
        kind === 'interest_saved' || kind === 'check_requested'
      ))
      .map(({ sequence }) => sequence);
    const requiredWorkingNoteSourceIds = work.visibleEvents
      .filter(({ kind }) => kind === 'guidance_saved')
      .map(({ sequence }) => sequence);
    return await new AgentCommunicationToolService(
      this.communication,
      work.agent,
      work.user,
      work.workId,
      work.workNumber,
      work.horizonSequence,
      requiredRequestSourceIds,
      requiredWorkingNoteSourceIds,
    ).execute(input.toolName, input.arguments, input.signal);
  }

  async completeWork(input: {
    agentId: string;
    executionId: string;
    result: AgentWorkResult;
    signal: AbortSignal;
  }): Promise<AgentWorkDisposition> {
    return await this.#settlement.runExclusive(async () => {
      input.signal.throwIfAborted();
      const work = await this.#readWork(input.agentId, input.executionId);
      if (!work) {
        return { kind: 'accepted' };
      }
      if (!(await this.store.readWorkspace()).backgroundChecksEnabled) {
        await this.store.interruptAgentWake(
          input.agentId,
          input.executionId,
        );
        return this.#retry('Background checks paused before Lucid commit.');
      }
      if (
        input.result.outcome !== 'done'
        || input.result.decision === 'escalate'
      ) {
        await this.store.failAgentWake(input.agentId, input.executionId);
        return { kind: 'accepted' };
      }

      const validationFailure = await this.#validateRequiredEffects(work);
      if (validationFailure) {
        await this.store.failAgentWake(input.agentId, input.executionId);
        return this.#retry(validationFailure);
      }

      await this.store.recordWakeCompletion({
        wakeNumber: work.workNumber,
        actorAgentId: input.agentId,
        idempotencyKey: `${work.workId}:completed`,
        title: `${work.agent.name} completes a background check`,
        content: 'The agent finished processing its claimed mailbox messages.',
        metadata: {
          visibility: 'operator',
          workId: work.workId,
          executionId: input.executionId,
          heartbeatRunId: input.result.runId,
          heartbeatSummary: input.result.summary,
          decision: input.result.decision,
          outcome: input.result.outcome,
        },
      });
      await this.store.completeAgentWake(
        input.agentId,
        input.executionId,
        work.horizonSequence,
      );
      await this.#triggerRecipients(input.agentId, work.workNumber);
      return { kind: 'accepted' };
    });
  }

  async failWork(input: {
    agentId: string;
    executionId: string;
    signal: AbortSignal;
  }): Promise<void> {
    await this.#settlement.runExclusive(async () => {
      input.signal.throwIfAborted();
      if (await this.#readWork(input.agentId, input.executionId)) {
        await this.store.failAgentWake(input.agentId, input.executionId);
      }
    });
  }

  async interruptWork(input: {
    agentId: string;
    executionId: string;
    signal: AbortSignal;
  }): Promise<void> {
    await this.#settlement.runExclusive(async () => {
      input.signal.throwIfAborted();
      if (await this.#readWork(input.agentId, input.executionId)) {
        await this.store.interruptAgentWake(
          input.agentId,
          input.executionId,
        );
      }
    });
  }

  async #readWorkForUser(
    userId: string,
    executionId: string,
  ): Promise<AgentWorkClaim | undefined> {
    const agent = (await this.store.listAgents())
      .find((candidate) => candidate.userId === userId);
    return agent ? await this.#readWork(agent.id, executionId) : undefined;
  }

  async #readWork(
    agentId: string,
    executionId: string,
  ): Promise<AgentWorkClaim | undefined> {
    const claim = await this.store.readClaimedAgentWake(
      agentId,
      executionId,
    );
    return claim ? await this.#toWorkClaim(claim) : undefined;
  }

  async #toWorkClaim(
    claim: AgentWakeClaim,
  ): Promise<AgentWorkClaim> {
    return {
      agent: claim.agent,
      user: claim.user,
      workId: claim.wakeId,
      executionId: claim.claimToken,
      workNumber: claim.wakeNumber,
      visibleEvents: claim.visibleEvents,
      horizonSequence: claim.horizonSequence,
      workingContext: await this.workingContext.readAgentWorkingContext(
        claim.agent.id,
        claim.horizonSequence,
      ),
    };
  }

  async #validateRequiredEffects(
    work: AgentWorkClaim,
  ): Promise<string | undefined> {
    const requiredRequests = work.visibleEvents.filter(({ kind }) => (
      kind === 'interest_saved' || kind === 'check_requested'
    ));
    const requestsComplete = (await Promise.all(requiredRequests.map(
      ({ sequence }) => this.store.findAgentPublishedRequestForTrigger(
        work.agent.id,
        sequence,
      ),
    ))).every(Boolean);
    if (!requestsComplete) {
      return 'The agent finished without sharing the required network request.';
    }

    const requiredWorkingNotes = work.visibleEvents
      .filter(({ kind }) => kind === 'guidance_saved');
    const notesComplete = (await Promise.all(requiredWorkingNotes.map(
      ({ sequence }) => this.store.hasAgentUpdatedWorkingNoteThrough(
        work.agent.id,
        sequence,
      ),
    ))).every(Boolean);
    return notesComplete
      ? undefined
      : 'The agent finished without revising its working note for the latest guidance.';
  }

  async #triggerRecipients(
    sourceAgentId: string,
    workNumber: number,
  ): Promise<void> {
    const [messages, activeAgents] = await Promise.all([
      this.store.listAgentWakeCommunicationEvents(
        sourceAgentId,
        workNumber,
      ),
      this.store.listActiveAgents(),
    ]);
    const activeAgentIds = new Set(activeAgents.map(({ id }) => id));
    const recipientIds = new Set<string>();

    for (const message of messages) {
      if (message.kind === 'direct_message') {
        if (message.targetAgentId && activeAgentIds.has(message.targetAgentId)) {
          recipientIds.add(message.targetAgentId);
        }
        continue;
      }
      const role = networkMessageRoleSchema.safeParse(
        message.metadata.messageRole,
      ).data;
      if (role === 'request') {
        activeAgents
          .filter(({ id }) => id !== sourceAgentId)
          .forEach(({ id }) => recipientIds.add(id));
        continue;
      }
      if (role === 'response' && message.replyToSequence) {
        const repliedTo = await this.store.readEvent(message.replyToSequence);
        if (
          repliedTo?.actorAgentId
          && repliedTo.actorAgentId !== sourceAgentId
          && activeAgentIds.has(repliedTo.actorAgentId)
        ) {
          recipientIds.add(repliedTo.actorAgentId);
        }
      }
    }

    const recipients = [...recipientIds];
    (await Promise.allSettled(recipients.map((agentId) => (
      this.trigger.triggerAgent(agentId)
    )))).forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn({
          error: result.reason,
          sourceAgentId,
          targetAgentId: recipients[index],
          workNumber,
        }, 'lucid.agent_work.recipient_trigger_failed');
      }
    });
  }

  #retry(summary: string): AgentWorkDisposition {
    return { kind: 'retry', summary, delayMs: this.config.retryDelayMs };
  }
}
