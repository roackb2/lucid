/**
 * Application-service boundary for user-driven discovery commands.
 *
 * This module coordinates durable product state with representative heartbeat
 * tasks and owns compensation when those two systems cannot change atomically.
 * HTTP validation, database queries, and model execution stay outside it.
 */
import pick from 'lodash/pick.js';
import type { DiscoveryRepository } from './discovery-repository.js';
import { USER_AGENT_ID } from './default-participants.js';
import type {
  Agent,
  AssistedParticipantContextView,
  CreateAssistedParticipantInput,
  DiscoveryWorkspaceSnapshot,
  Participant,
  UpdateAssistedParticipantContextInput,
} from './discovery-types.js';
import type {
  RepresentativeAgentHeartbeatService,
} from './representative-agent-heartbeat-service.js';

export class DiscoveryInputError extends Error {}

/**
 * Owns the user-facing delegated-discovery workspace.
 *
 * The repository owns durable product records. The heartbeat service owns
 * representative-agent scheduling and checkpoints. This service coordinates
 * user actions across those boundaries and returns one complete UI snapshot.
 */
export class DiscoveryWorkspaceService {
  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly heartbeats: RepresentativeAgentHeartbeatService,
    private readonly runtime: { model: string; heddleVersion: string },
  ) {}

  async snapshot(): Promise<DiscoveryWorkspaceSnapshot> {
    const [workspace, backgroundChecks] = await Promise.all([
      this.repository.readSnapshot(),
      this.heartbeats.snapshot(),
    ]);
    return {
      ...workspace,
      backgroundChecks,
      runtime: this.runtime,
    };
  }

  async saveInterest(content: string): Promise<DiscoveryWorkspaceSnapshot> {
    await this.repository.saveInterest(content);
    const userAgent = await this.repository.requireUserAgent();
    await this.heartbeats.triggerAgent(userAgent.id);
    return await this.snapshot();
  }

  async runNow(): Promise<DiscoveryWorkspaceSnapshot> {
    if (!(await this.heartbeats.snapshot()).enabled) {
      throw new DiscoveryInputError(
        'Background checks are paused. Resume them before running now.',
      );
    }
    const interest = await this.repository.findSavedInterest();
    if (!interest) {
      throw new DiscoveryInputError(
        'Save what Lucid should look for before running a check.',
      );
    }

    const userAgent = await this.repository.requireUserAgent();
    // A manual check is mailbox input, not a second execution path. Persist it
    // before triggering Heddle so a crash cannot lose the user's request.
    await this.repository.appendEvent({
      kind: 'check_requested',
      targetAgentId: userAgent.id,
      targetParticipantId: userAgent.participantId,
      title: 'You ask Lucid to check now',
      content: `Review the current saved interest and look for newly available matches:\n\n${interest.content}`,
      metadata: {
        visibility: 'user-and-agent',
        source: 'user',
        interestSequence: interest.sequence,
      },
    });
    try {
      await this.heartbeats.runNow();
    } catch (error) {
      throw new DiscoveryInputError(
        error instanceof Error
          ? error.message
          : 'Lucid could not queue a background check.',
      );
    }
    return await this.snapshot();
  }

  async setBackgroundChecksEnabled(
    enabled: boolean,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    await this.heartbeats.setEnabled(enabled);
    return await this.snapshot();
  }

  async createAssistedParticipant(
    input: CreateAssistedParticipantInput,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    let participantId: string | undefined;
    try {
      // Product identity and approved context are durable before a scheduler
      // task is materialized; the repository creates participant + agent atomically.
      const created = await this.repository.createAssistedParticipant(input);
      participantId = created.participant.id;
      try {
        await this.heartbeats.reconcileAgentTasks();
      } catch (error) {
        // Storage and Heddle do not share a transaction. Keep the saved record
        // inspectable but unable to receive mail if task creation fails.
        await this.repository.setParticipantStatus(
          created.participant.id,
          'disabled',
        );
        await this.heartbeats.reconcileAgentTasks();
        throw error;
      }
      return await this.snapshot();
    } catch (error) {
      throw new DiscoveryInputError(
        participantId
          ? 'The participant was saved in a disabled state because background setup failed. Try enabling them again.'
          : inputErrorMessage(error, 'Lucid could not add this participant.'),
      );
    }
  }

  async assistedParticipantContext(
    participantId: string,
  ): Promise<AssistedParticipantContextView> {
    const { participant } = await this.requireAssistedParticipant(
      participantId,
    );
    return pick(participant, [
      'id',
      'displayName',
      'privateContext',
      'contextConsentAt',
      'status',
    ]);
  }

  async updateAssistedParticipantContext(
    input: UpdateAssistedParticipantContextInput,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    const { agent, participant } = await this.requireAssistedParticipant(
      input.participantId,
    );
    const shouldResume = participant.status === 'active';
    try {
      // An active model may retain the old private context until settlement.
      // Disable its task before replacing that context, then restore only the
      // task whose authoritative participant state remains active.
      if (shouldResume) {
        await this.heartbeats.disableAgentTasks([agent.id]);
      }
      await this.repository.updateAssistedParticipantContext(input);
      if (shouldResume) {
        try {
          await this.heartbeats.enableAgentTask(agent.id);
        } catch (error) {
          await this.repository.setParticipantStatus(
            participant.id,
            'disabled',
          );
          await this.heartbeats.reconcileAgentTasks();
          throw error;
        }
      }
      return await this.snapshot();
    } catch (error) {
      await this.heartbeats.reconcileAgentTasks();
      throw new DiscoveryInputError(
        inputErrorMessage(
          error,
          'Lucid could not update this participant context.',
        ),
      );
    }
  }

  async pauseSimulatedParticipants(): Promise<DiscoveryWorkspaceSnapshot> {
    const simulatedParticipants = (await this.repository.listParticipants())
      .filter((participant) => (
        participant.kind === 'synthetic'
        && participant.status === 'active'
      ));
    if (!simulatedParticipants.length) {
      return await this.snapshot();
    }
    const agents = await Promise.all(simulatedParticipants.map(
      (participant) => this.repository.requireAgentByParticipantId(
        participant.id,
      ),
    ));

    try {
      // Settle and disable every fixture task before changing domain state.
      // Heddle targets only these representatives, so real sources keep running.
      await this.heartbeats.disableAgentTasks(agents.map(({ id }) => id));
      for (const participant of simulatedParticipants) {
        await this.repository.setParticipantStatus(
          participant.id,
          'disabled',
        );
      }
      await this.heartbeats.reconcileAgentTasks();
      return await this.snapshot();
    } catch (error) {
      await this.heartbeats.reconcileAgentTasks();
      throw new DiscoveryInputError(
        inputErrorMessage(
          error,
          'Lucid could not pause the simulated sources.',
        ),
      );
    }
  }

  async setParticipantEnabled(
    participantId: string,
    enabled: boolean,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    const agent = await this.requireSourceAgent(participantId);
    try {
      if (!enabled) {
        // Quiesce execution before closing the participant's mailbox boundary.
        await this.heartbeats.disableAgentTasks([agent.id]);
      }
      // On resume the repository advances the mailbox floor before the task can
      // run, deliberately skipping messages produced while this source was paused.
      await this.repository.setParticipantStatus(
        participantId,
        enabled ? 'active' : 'disabled',
      );
      if (enabled) {
        try {
          await this.heartbeats.enableAgentTask(agent.id);
        } catch (error) {
          // Never leave an active participant without a runnable representative.
          await this.repository.setParticipantStatus(
            participantId,
            'disabled',
          );
          await this.heartbeats.reconcileAgentTasks();
          throw error;
        }
      } else {
        await this.heartbeats.reconcileAgentTasks();
      }
      return await this.snapshot();
    } catch (error) {
      await this.heartbeats.reconcileAgentTasks();
      throw new DiscoveryInputError(
        inputErrorMessage(error, 'Lucid could not update this participant.'),
      );
    }
  }

  async retireParticipant(
    participantId: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    const agent = await this.requireSourceAgent(participantId);
    try {
      // Stop and settle the representative before permanently scrubbing the
      // private context it could otherwise still hold in an active wake.
      await this.heartbeats.disableAgentTasks([agent.id]);
      await this.repository.retireParticipant(participantId);
      await this.heartbeats.reconcileAgentTasks();
      return await this.snapshot();
    } catch (error) {
      await this.heartbeats.reconcileAgentTasks();
      throw new DiscoveryInputError(
        inputErrorMessage(error, 'Lucid could not retire this participant.'),
      );
    }
  }

  async submitFeedback(
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    try {
      await this.repository.saveFeedback(findingSequence, content);
    } catch (error) {
      throw new DiscoveryInputError(
        error instanceof Error
          ? error.message
          : 'Lucid could not save this feedback.',
      );
    }
    const userAgent = await this.repository.requireUserAgent();
    await this.heartbeats.triggerAgent(userAgent.id);
    return await this.snapshot();
  }

  async resetWorkspace(): Promise<DiscoveryWorkspaceSnapshot> {
    await this.heartbeats.resetWorkspace();
    return await this.snapshot();
  }

  private async requireSourceAgent(participantId: string) {
    const agent = await this.repository.requireAgentByParticipantId(
      participantId,
    );
    if (agent.id === USER_AGENT_ID) {
      throw new DiscoveryInputError(
        'The local user participant cannot be changed here.',
      );
    }
    return agent;
  }

  private async requireAssistedParticipant(
    participantId: string,
  ): Promise<{ participant: Participant; agent: Agent }> {
    const [participant, agent] = await Promise.all([
      this.repository.requireParticipant(participantId),
      this.repository.requireAgentByParticipantId(participantId),
    ]);
    if (
      agent.id === USER_AGENT_ID
      || participant.kind !== 'human'
      || participant.status === 'retired'
    ) {
      throw new DiscoveryInputError(
        'Only an active or paused assisted participant has reviewable context.',
      );
    }
    return { participant, agent };
  }
}

function inputErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
