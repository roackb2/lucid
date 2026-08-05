/**
 * Application boundary for the local participant's discovery workspace.
 *
 * This service deliberately returns a participant-scoped product projection.
 * Network registration, world diagnostics, and participant administration live
 * in ParticipantNetworkService and never leak into the main user snapshot.
 */
import type { DiscoveryRepository } from './discovery-repository.js';
import { LOCAL_USER_ID } from './local-participant.js';
import type { DiscoveryWorkspaceSnapshot } from './discovery-types.js';
import type {
  RepresentativeAgentHeartbeatService,
} from './representative-agent-heartbeat-service.js';

export class DiscoveryInputError extends Error {}

/** Coordinates local-user commands with durable mailbox execution. */
export class DiscoveryWorkspaceService {
  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly heartbeats: RepresentativeAgentHeartbeatService,
    private readonly runtime: { model: string; heddleVersion: string },
  ) {}

  async snapshot(): Promise<DiscoveryWorkspaceSnapshot> {
    const workspace = await this.repository.readSnapshot();
    const backgroundChecks = await this.heartbeats.snapshotForAgent(
      workspace.representative.id,
    );
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
    const userAgent = await this.repository.requireUserAgent();
    const heartbeat = await this.heartbeats.snapshotForAgent(userAgent.id);
    if (!heartbeat.enabled) {
      throw new DiscoveryInputError(
        'Background checks are paused. Resume them before running now.',
      );
    }
    if (
      userAgent.status === 'error'
      || heartbeat.tasks.some(({ status }) => status === 'failed')
    ) {
      throw new DiscoveryInputError(
        'The current assignment needs to be retried before starting another check.',
      );
    }
    const interest = await this.repository.findSavedInterest();
    if (!interest) {
      throw new DiscoveryInputError(
        'Save what Lucid should look for before running a check.',
      );
    }
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

  async retryCurrentWake(): Promise<DiscoveryWorkspaceSnapshot> {
    const userAgent = await this.repository.requireUserAgent();
    const heartbeat = await this.heartbeats.snapshotForAgent(userAgent.id);
    if (!heartbeat.enabled) {
      throw new DiscoveryInputError(
        'Background checks are paused. Resume them before retrying.',
      );
    }
    if (
      userAgent.status !== 'error'
      && heartbeat.tasks.every(({ status }) => status !== 'failed')
    ) {
      throw new DiscoveryInputError(
        'There is no failed representative wake to retry.',
      );
    }

    // Retry the fixed Heddle checkpoint directly. Appending a check_requested
    // event here would create a second causal root and hide the original
    // failure instead of repairing it.
    await this.heartbeats.triggerAgent(userAgent.id);
    return await this.snapshot();
  }

  async setBackgroundChecksEnabled(
    enabled: boolean,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    const userAgent = await this.repository.requireUserAgent();
    try {
      if (!enabled) {
        // The durable Heddle task owns this participant's listening preference.
        // Keep the participant active so mail accumulates for a later resume.
        await this.heartbeats.disableAgentTasks([userAgent.id]);
      } else {
        await this.heartbeats.enableAgentTask(userAgent.id);
        await this.heartbeats.triggerAgent(userAgent.id);
      }
      return await this.snapshot();
    } catch (error) {
      await this.heartbeats.reconcileAgentTasks();
      throw new DiscoveryInputError(
        error instanceof Error
          ? error.message
          : 'Lucid could not change your representative status.',
      );
    }
  }

  async submitFeedback(
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    await this.repository.saveFeedback(
      LOCAL_USER_ID,
      findingSequence,
      content,
    );
    const userAgent = await this.repository.requireUserAgent();
    await this.heartbeats.triggerAgent(userAgent.id);
    return await this.snapshot();
  }
}
