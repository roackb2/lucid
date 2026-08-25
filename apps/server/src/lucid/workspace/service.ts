/**
 * Application boundary for one authenticated user's discovery workspace.
 *
 * This service deliberately returns a user-scoped product projection.
 * Network registration, world diagnostics, and user administration live
 * in UserNetworkService and never leak into the main user snapshot.
 */
import type { DiscoveryWorkspaceSnapshot } from '../discovery-types.js';
import type {
  AgentHeartbeatControl,
} from '../agent/heartbeat-control.js';
import type { DiscoveryWorkspaceStore } from './store.js';

export class DiscoveryInputError extends Error {}

/** Coordinates user commands with durable mailbox execution. */
export class DiscoveryWorkspaceService {
  constructor(
    private readonly store: DiscoveryWorkspaceStore,
    private readonly heartbeats: AgentHeartbeatControl,
    private readonly runtime: { model: string; heddleVersion: string },
  ) {}

  async snapshot(userId: string): Promise<DiscoveryWorkspaceSnapshot> {
    const workspace = await this.store.readSnapshot(userId);
    const backgroundChecks = await this.heartbeats.snapshotForAgent(
      workspace.agent.id,
    );
    return {
      ...workspace,
      backgroundChecks,
      runtime: this.runtime,
    };
  }

  async saveInterest(
    userId: string,
    content: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    await this.store.saveInterest(userId, content);
    const agent = await this.store.requireAgentForUser(userId);
    await this.heartbeats.triggerAgent(agent.id);
    return await this.snapshot(userId);
  }

  async runNow(userId: string): Promise<DiscoveryWorkspaceSnapshot> {
    const agent = await this.store.requireAgentForUser(userId);
    const heartbeat = await this.heartbeats.snapshotForAgent(agent.id);
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
      agent.status === 'error'
      || heartbeat.tasks.some(({ status }) => status === 'failed')
    ) {
      throw new DiscoveryInputError(
        'The current assignment needs to be retried before starting another check.',
      );
    }
    const interest = await this.store.findSavedInterest(userId);
    if (!interest) {
      throw new DiscoveryInputError(
        'Save what Lucid should look for before running a check.',
      );
    }
    const workingContext = await this.store
      .readAgentWorkingContext(
        agent.id,
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
      ?? 'No user guidance has been received yet.';
    // A manual check is mailbox input, not a second execution path. Persist it
    // before triggering Heddle so a crash cannot lose the user's request. The
    // request carries the agent's current learning so the next
    // network outreach does not simply repeat the original broad assignment.
    await this.store.recordCheckRequest({
      targetAgentId: agent.id,
      targetUserId: agent.userId,
      title: 'You ask Lucid to check now',
      content: `Required change to the next network request:
Ask using the current working direction and latest user guidance below. Preserve the concrete constraints that distinguish a useful next result; do not send only another paraphrase of the original broad assignment.

Current working direction:
${workingDirection}

Latest user guidance:
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
      await this.heartbeats.triggerAgent(agent.id);
    } catch (error) {
      throw new DiscoveryInputError(
        error instanceof Error
          ? error.message
          : 'Lucid could not queue a background check.',
      );
    }
    return await this.snapshot(userId);
  }

  async retryCurrentWake(
    userId: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    const agent = await this.store.requireAgentForUser(userId);
    const heartbeat = await this.heartbeats.snapshotForAgent(agent.id);
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
      agent.status !== 'error'
      && heartbeat.tasks.every(({ status }) => status !== 'failed')
    ) {
      throw new DiscoveryInputError(
        'There is no failed agent wake to retry.',
      );
    }

    // Retry the fixed Heddle checkpoint directly. Appending a check_requested
    // event here would create a second request thread and hide the original
    // failure instead of repairing it.
    await this.heartbeats.triggerAgent(agent.id);
    return await this.snapshot(userId);
  }

  async setBackgroundChecksEnabled(
    userId: string,
    enabled: boolean,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    const agent = await this.store.requireAgentForUser(userId);
    try {
      if (!enabled) {
        // The durable Heddle task owns this user's listening preference.
        // Keep the user active so mail accumulates for a later resume.
        await this.heartbeats.disableAgentTasks([agent.id]);
      } else {
        await this.heartbeats.enableAgentTask(agent.id);
        await this.heartbeats.triggerAgent(agent.id);
      }
      return await this.snapshot(userId);
    } catch (error) {
      await this.heartbeats.reconcileAgentTasks();
      throw new DiscoveryInputError(
        error instanceof Error
          ? error.message
          : 'Lucid could not change your agent status.',
      );
    }
  }

  async submitFeedback(
    userId: string,
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    await this.store.saveFeedback(
      userId,
      findingSequence,
      content,
    );
    const agent = await this.store.requireAgentForUser(userId);
    await this.heartbeats.triggerAgent(agent.id);
    return await this.snapshot(userId);
  }

  async submitGuidance(
    userId: string,
    content: string,
  ): Promise<DiscoveryWorkspaceSnapshot> {
    if (!(await this.store.findSavedInterest(userId))) {
      throw new DiscoveryInputError(
        'Save what Lucid should look for before refining its direction.',
      );
    }
    // Preserve the user's words as raw private input. The heartbeat is
    // responsible for producing a separate agent-authored working-note
    // revision, and cannot consume this mailbox event until that revision is
    // durably recorded.
    await this.store.saveGuidance(userId, content);
    const agent = await this.store.requireAgentForUser(userId);
    await this.heartbeats.triggerAgent(agent.id);
    return await this.snapshot(userId);
  }
}
