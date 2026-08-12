/**
 * Application boundary for one authenticated participant's discovery workspace.
 *
 * This service deliberately returns a participant-scoped product projection.
 * Network registration, world diagnostics, and participant administration live
 * in ParticipantNetworkService and never leak into the main user snapshot.
 */
import type { DiscoveryWorkspaceSnapshot } from '../discovery-types.js';
import type {
  RepresentativeAgentHeartbeatService,
} from '../representative/heartbeat-service.js';
import type { DiscoveryWorkspaceStore } from './store.js';

export class DiscoveryInputError extends Error {}

/** Coordinates participant commands with durable mailbox execution. */
export class DiscoveryWorkspaceService {
  constructor(
    private readonly store: DiscoveryWorkspaceStore,
    private readonly heartbeats: RepresentativeAgentHeartbeatService,
    private readonly runtime: { model: string; heddleVersion: string },
  ) {}

  async snapshot(participantId: string): Promise<DiscoveryWorkspaceSnapshot> {
    const workspace = await this.store.readSnapshot(participantId);
    const backgroundChecks = await this.heartbeats.snapshotForAgent(
      workspace.representative.id,
    );
    return {
      ...workspace,
      backgroundChecks,
      runtime: this.runtime,
    };
  }

  async saveInterest(
    participantId: string,
    content: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    await this.store.saveInterest(participantId, content);
    const userAgent = await this.store.requireParticipantAgent(participantId);
    await this.heartbeats.triggerAgent(userAgent.id);
    return await this.snapshot(participantId);
  }

  async runNow(participantId: string): Promise<DiscoveryWorkspaceSnapshot> {
    const userAgent = await this.store.requireParticipantAgent(participantId);
    const heartbeat = await this.heartbeats.snapshotForAgent(userAgent.id);
    if (!heartbeat.dispatchEnabled) {
      throw new DiscoveryInputError(
        'The hosted demo is paused by an operator. Try again after dispatch resumes.',
      );
    }
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
    const interest = await this.store.findSavedInterest(participantId);
    if (!interest) {
      throw new DiscoveryInputError(
        'Save what Lucid should look for before running a check.',
      );
    }
    const workingContext = await this.store
      .readRepresentativeWorkingContext(
        userAgent.id,
        Number.MAX_SAFE_INTEGER,
      );
    const latestFindingFeedback = workingContext.findings
      .flatMap(({ feedback }) => feedback ? [feedback] : [])
      .sort((left, right) => right.sequence - left.sequence)
      .at(0);
    const latestDirectGuidance = workingContext.principalInputs
      .filter(({ kind }) => kind === 'guidance_saved')
      .sort((left, right) => right.sequence - left.sequence)
      .at(0);
    const latestGuidance = [latestFindingFeedback, latestDirectGuidance]
      .filter((event) => event !== undefined)
      .sort((left, right) => right.sequence - left.sequence)
      .at(0);
    const workingDirection = workingContext.workingNote?.content
      ?? 'No refined working direction has been saved yet.';
    const guidanceDirection = latestGuidance?.content
      ?? 'No participant guidance has been received yet.';
    // A manual check is mailbox input, not a second execution path. Persist it
    // before triggering Heddle so a crash cannot lose the user's request. The
    // request carries the representative's current learning so the next
    // network outreach does not simply repeat the original broad assignment.
    await this.store.recordCheckRequest({
      targetAgentId: userAgent.id,
      targetParticipantId: userAgent.participantId,
      title: 'You ask Lucid to check now',
      content: `Required change to the next network request:
Ask using the current working direction and latest participant guidance below. Preserve the concrete constraints that distinguish a useful next result; do not send only another paraphrase of the original broad assignment.

Current working direction:
${workingDirection}

Latest participant guidance:
${guidanceDirection}

Original saved assignment (background context only):
${interest.content}`,
      metadata: {
        visibility: 'user-and-agent',
        source: 'user',
        interestSequence: interest.sequence,
        workingNoteSequence: workingContext.workingNote?.sequence,
        latestGuidanceSequence: latestGuidance?.sequence,
      },
    });
    try {
      await this.heartbeats.triggerAgent(userAgent.id);
    } catch (error) {
      throw new DiscoveryInputError(
        error instanceof Error
          ? error.message
          : 'Lucid could not queue a background check.',
      );
    }
    return await this.snapshot(participantId);
  }

  async retryCurrentWake(
    participantId: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    const userAgent = await this.store.requireParticipantAgent(participantId);
    const heartbeat = await this.heartbeats.snapshotForAgent(userAgent.id);
    if (!heartbeat.dispatchEnabled) {
      throw new DiscoveryInputError(
        'The hosted demo is paused by an operator. Try again after dispatch resumes.',
      );
    }
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
    // event here would create a second request thread and hide the original
    // failure instead of repairing it.
    await this.heartbeats.triggerAgent(userAgent.id);
    return await this.snapshot(participantId);
  }

  async setBackgroundChecksEnabled(
    participantId: string,
    enabled: boolean,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    const userAgent = await this.store.requireParticipantAgent(participantId);
    try {
      if (!enabled) {
        // The durable Heddle task owns this participant's listening preference.
        // Keep the participant active so mail accumulates for a later resume.
        await this.heartbeats.disableAgentTasks([userAgent.id]);
      } else {
        await this.heartbeats.enableAgentTask(userAgent.id);
        await this.heartbeats.triggerAgent(userAgent.id);
      }
      return await this.snapshot(participantId);
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
    participantId: string,
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    await this.store.saveFeedback(
      participantId,
      findingSequence,
      content,
    );
    const userAgent = await this.store.requireParticipantAgent(participantId);
    await this.heartbeats.triggerAgent(userAgent.id);
    return await this.snapshot(participantId);
  }

  async submitGuidance(
    participantId: string,
    content: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    if (!(await this.store.findSavedInterest(participantId))) {
      throw new DiscoveryInputError(
        'Save what Lucid should look for before refining its direction.',
      );
    }
    // Preserve the participant's words as raw private input. The heartbeat is
    // responsible for producing a separate agent-authored working-note
    // revision, and cannot consume this mailbox event until that revision is
    // durably recorded.
    await this.store.saveGuidance(participantId, content);
    const userAgent = await this.store.requireParticipantAgent(participantId);
    await this.heartbeats.triggerAgent(userAgent.id);
    return await this.snapshot(participantId);
  }
}
