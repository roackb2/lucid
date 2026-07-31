import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import type { LucidLogger } from '../logger.js';
import type { DiscoveryEventRepository } from './discovery-event-repository.js';
import {
  type ActiveDiscoveryRunView,
  type AgentRunner,
  type AgentRunHandle,
  type AgentStepContext,
  type DiscoveryRunPhase,
  type DiscoveryWorkspaceSnapshot,
} from './discovery-types.js';

type DiscoveryRunStep = {
  agentId: string;
  phase: DiscoveryRunPhase;
};

type ActiveDiscoveryRun = ActiveDiscoveryRunView & {
  steps: DiscoveryRunStep[];
  controller: AbortController;
  currentAgentRun?: AgentRunHandle;
  completion?: Promise<void>;
};

export class DiscoveryRunBusyError extends Error {}
export class DiscoveryInputError extends Error {}

/**
 * Coordinates one bounded discovery run for the local user.
 *
 * The run asks the user agent to request matches, lets each simulated source
 * respond once, then asks the user agent to report a sourced finding or no
 * match. Steps are serialized so unread cursors advance only after successful
 * Heddle execution.
 */
export class DiscoveryRunService {
  private activeRun?: ActiveDiscoveryRun;

  constructor(
    private readonly repository: DiscoveryEventRepository,
    private readonly agentRunner: AgentRunner,
    private readonly runtime: { model: string; heddleVersion: string },
    private readonly logger: LucidLogger,
  ) {
    this.repository.initialize();
  }

  snapshot(): DiscoveryWorkspaceSnapshot {
    return {
      ...this.repository.readSnapshot(),
      activeRun: this.activeRun
        ? toActiveDiscoveryRunView(this.activeRun)
        : undefined,
      runtime: this.runtime,
    };
  }

  saveInterest(content: string): DiscoveryWorkspaceSnapshot {
    this.requireIdle(
      'Wait for the active discovery check before changing the saved interest.',
    );
    this.repository.saveInterest(content);
    return this.snapshot();
  }

  startRun(): ActiveDiscoveryRunView {
    if (this.activeRun) {
      throw new DiscoveryRunBusyError('A discovery check is already running.');
    }
    if (!this.repository.findSavedInterest()) {
      throw new DiscoveryInputError(
        'Save what Lucid should look for before starting a check.',
      );
    }

    const agents = this.repository.listAgents();
    const userAgent = this.repository.requireUserAgent();
    const sourceAgents = agents.filter((agent) => agent.id !== userAgent.id);
    if (!sourceAgents.length) {
      throw new DiscoveryInputError(
        'No participant sources are available for this discovery check.',
      );
    }

    const steps: DiscoveryRunStep[] = [
      { agentId: userAgent.id, phase: 'requesting' },
      ...sourceAgents.map((agent): DiscoveryRunStep => ({
        agentId: agent.id,
        phase: 'responding',
      })),
      { agentId: userAgent.id, phase: 'reporting' },
    ];
    const activeRun: ActiveDiscoveryRun = {
      id: `discovery_${randomUUID()}`,
      totalSteps: steps.length,
      completedSteps: 0,
      startedAt: dayjs().toISOString(),
      latestActivity: 'Preparing the saved interest for matching.',
      cancelRequested: false,
      steps,
      controller: new AbortController(),
    };
    this.activeRun = activeRun;

    const completion = this.executeDiscoveryRun(activeRun)
      .catch((error: unknown) => {
        this.logger.error(
          { error, discoveryRunId: activeRun.id },
          'lucid.discovery_run.failed',
        );
      })
      .finally(() => {
        if (this.activeRun?.id === activeRun.id) {
          this.activeRun = undefined;
        }
      });
    activeRun.completion = completion;
    void completion;

    return toActiveDiscoveryRunView(activeRun);
  }

  submitFeedback(
    findingSequence: number,
    content: string,
  ): DiscoveryWorkspaceSnapshot {
    this.requireIdle('Wait for the active discovery check before responding.');
    try {
      this.repository.saveFeedback(findingSequence, content);
    } catch (error) {
      throw new DiscoveryInputError(
        error instanceof Error
          ? error.message
          : 'Lucid could not save this feedback.',
      );
    }
    return this.snapshot();
  }

  cancelRun(): boolean {
    if (!this.activeRun) {
      return false;
    }
    this.requestCancellation(this.activeRun);
    return true;
  }

  async stop(): Promise<void> {
    const activeRun = this.activeRun;
    if (!activeRun) {
      return;
    }
    this.requestCancellation(activeRun);
    await activeRun.completion;
  }

  resetWorkspace(): DiscoveryWorkspaceSnapshot {
    this.requireIdle(
      'Stop the active discovery check before resetting the workspace.',
    );
    this.repository.reset();
    return this.snapshot();
  }

  private async executeDiscoveryRun(
    activeRun: ActiveDiscoveryRun,
  ): Promise<void> {
    for (const [index, step] of activeRun.steps.entries()) {
      if (activeRun.controller.signal.aborted) {
        return;
      }

      const agentStep = this.repository.beginAgentStep(
        step.agentId,
        activeRun.id,
        step.phase,
      );
      activeRun.agentId = agentStep.agent.id;
      activeRun.agentName = agentStep.agent.name;
      activeRun.phase = agentStep.phase;
      activeRun.latestActivity = phaseActivity(
        agentStep.phase,
        agentStep.agent.name,
      );

      const completed = await this.executeAgentStep(activeRun, agentStep);
      activeRun.agentExecutionId = undefined;
      activeRun.currentAgentRun = undefined;
      activeRun.agentId = undefined;
      activeRun.agentName = undefined;
      activeRun.phase = undefined;

      if (!completed || activeRun.controller.signal.aborted) {
        return;
      }
      activeRun.completedSteps = index + 1;
      activeRun.latestActivity = activeRun.completedSteps < activeRun.totalSteps
        ? 'Checking the next participant source.'
        : 'Discovery check completed.';
    }
  }

  private async executeAgentStep(
    activeRun: ActiveDiscoveryRun,
    agentStep: AgentStepContext,
  ): Promise<boolean> {
    try {
      const agentRun = await this.agentRunner.startAgentStep({
        agent: agentStep.agent,
        participant: agentStep.participant,
        phase: agentStep.phase,
        discoveryRunId: activeRun.id,
        stepNumber: agentStep.stepNumber,
        visibleEvents: agentStep.visibleEvents,
        signal: activeRun.controller.signal,
        onActivity: (activity) => {
          activeRun.latestActivity = activity.summary;
        },
      });
      activeRun.currentAgentRun = agentRun;
      activeRun.agentExecutionId = agentRun.executionId;

      const result = await agentRun.result;
      this.repository.appendEvent({
        stepNumber: agentStep.stepNumber,
        kind: 'agent_step_completed',
        actorAgentId: agentStep.agent.id,
        title: `${agentStep.agent.name} completes a discovery step`,
        content: result.summary,
        metadata: {
          visibility: 'operator',
          discoveryRunId: activeRun.id,
          phase: agentStep.phase,
          outcome: result.outcome,
          toolCount: result.toolCount,
          traceFile: result.traceFile,
          agentExecutionId: agentRun.executionId,
        },
      });
      this.repository.completeAgentStep(
        agentStep.agent.id,
        agentStep.horizonSequence,
      );

      if (agentStep.phase === 'reporting') {
        this.repository.ensureNoFindingResult(
          activeRun.id,
          agentStep.stepNumber,
        );
      }
      return true;
    } catch (error) {
      const cancelled = activeRun.controller.signal.aborted;
      this.repository.appendEvent({
        stepNumber: agentStep.stepNumber,
        kind: 'error',
        actorAgentId: agentStep.agent.id,
        title: cancelled
          ? `${agentStep.agent.name} was stopped`
          : `${agentStep.agent.name} could not complete a discovery step`,
        content: cancelled
          ? 'The user stopped this discovery check. Unread events remain available for a later run.'
          : 'The agent execution failed. Check server logs and model credentials; unread events were not consumed.',
        metadata: {
          visibility: 'operator',
          cancelled,
          discoveryRunId: activeRun.id,
          phase: agentStep.phase,
          agentExecutionId: activeRun.agentExecutionId,
        },
      });
      if (cancelled) {
        this.repository.interruptAgentStep(agentStep.agent.id);
        return false;
      }

      this.repository.failAgentStep(agentStep.agent.id);
      throw error;
    }
  }

  private requireIdle(message: string): void {
    if (this.activeRun) {
      throw new DiscoveryRunBusyError(message);
    }
  }

  private requestCancellation(activeRun: ActiveDiscoveryRun): void {
    activeRun.cancelRequested = true;
    activeRun.latestActivity = 'Stopping the active discovery check.';
    activeRun.controller.abort();
    activeRun.currentAgentRun?.cancel();
  }
}

function toActiveDiscoveryRunView(
  activeRun: ActiveDiscoveryRun,
): ActiveDiscoveryRunView {
  return {
    id: activeRun.id,
    totalSteps: activeRun.totalSteps,
    completedSteps: activeRun.completedSteps,
    startedAt: activeRun.startedAt,
    phase: activeRun.phase,
    agentId: activeRun.agentId,
    agentName: activeRun.agentName,
    agentExecutionId: activeRun.agentExecutionId,
    latestActivity: activeRun.latestActivity,
    cancelRequested: activeRun.cancelRequested,
  };
}

function phaseActivity(
  phase: DiscoveryRunPhase,
  agentName: string,
): string {
  return {
    requesting: `${agentName} is asking available participants for a match.`,
    responding: `${agentName} is checking its participant context.`,
    reporting: `${agentName} is deciding whether to report a finding.`,
  }[phase];
}
