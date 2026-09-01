import type {
  HostedHeartbeatAdmissionLifecycle,
  HostedHeartbeatResumeDecision,
  HostedHeartbeatResumePreparationInput,
} from '@heddleagent/execution-host-client/coordinator';
import {
  LUCID_BACKGROUND_WORK_GROUP_ID,
} from '../../lucid/agent/heartbeat-task-identity.js';
import type { AgentWakeStore } from '../../lucid/agent/store.js';

const RUNNING_WAKE_RETRY_MS = 5_000;

type BackgroundChecksResumeStore = Pick<
  AgentWakeStore,
  'prepareBackgroundChecksResume'
>;

/** Maps provider resume transitions to Lucid's fresh-mailbox product policy. */
export class LucidBackgroundChecksAdmissionLifecycle
implements HostedHeartbeatAdmissionLifecycle {
  constructor(private readonly store: BackgroundChecksResumeStore) {}

  async prepareResume(
    input: HostedHeartbeatResumePreparationInput,
  ): Promise<HostedHeartbeatResumeDecision> {
    input.signal.throwIfAborted();
    if (
      input.target.kind !== 'group'
      || input.target.groupId !== LUCID_BACKGROUND_WORK_GROUP_ID
    ) {
      return {
        status: 'blocked',
        summary: 'Lucid does not own the requested background admission group.',
      };
    }

    const preparation = await this.store.prepareBackgroundChecksResume({
      admissionGroupId: input.target.groupId,
      transitionId: input.transitionId,
    });
    input.signal.throwIfAborted();
    if (preparation.status === 'prepared') {
      return {
        status: 'ready',
        summary: 'Lucid prepared a fresh background-work boundary.',
      };
    }
    if (preparation.reason === 'background-checks-disabled') {
      return {
        status: 'blocked',
        summary: 'Lucid background checks are disabled by product policy.',
      };
    }
    return {
      status: 'retry',
      summary: 'Lucid is waiting for an active background check to settle.',
      retryAfterMs: RUNNING_WAKE_RETRY_MS,
    };
  }
}
