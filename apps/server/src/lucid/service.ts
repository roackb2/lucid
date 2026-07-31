import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import type { LucidLogger } from '../logger.js';
import type { LucidRepository } from './repository.js';
import {
  type ActiveJourneyView,
  type AgentMind,
  type AgentMindRun,
  type JourneyPhase,
  type LucidSnapshot,
  type WakeContext,
} from './types.js';

type JourneyStop = {
  agentId: string;
  phase: JourneyPhase;
};

type ActiveJourney = ActiveJourneyView & {
  route: JourneyStop[];
  controller: AbortController;
  currentRun?: AgentMindRun;
  completion?: Promise<void>;
};

export class LucidBusyError extends Error {}
export class LucidInputError extends Error {}

/**
 * Owns the local principal's bounded leave-and-return lifecycle.
 *
 * One journey wakes the home agent, each synthetic peer, then the home agent
 * again. It serializes Heddle turns, preserves unread input on failure, and
 * guarantees a principal-visible return or explicit quiet return only after a
 * successful final wake.
 */
export class LucidService {
  private activeJourney?: ActiveJourney;

  constructor(
    private readonly repository: LucidRepository,
    private readonly mind: AgentMind,
    private readonly runtime: { model: string; heddleVersion: string },
    private readonly logger: LucidLogger,
  ) {
    this.repository.initialize();
  }

  snapshot(): LucidSnapshot {
    return {
      ...this.repository.readSnapshot(),
      activeJourney: this.activeJourney
        ? toActiveJourneyView(this.activeJourney)
        : undefined,
      runtime: this.runtime,
    };
  }

  setIntent(content: string): LucidSnapshot {
    this.requireIdle('Wait for the active journey before changing Aster’s intent.');
    this.repository.setIntent(content);
    return this.snapshot();
  }

  startJourney(): ActiveJourneyView {
    if (this.activeJourney) {
      throw new LucidBusyError('Aster is already away on a journey.');
    }
    if (!this.repository.findLatestIntent()) {
      throw new LucidInputError('Tell Aster what to keep noticing before starting a journey.');
    }

    const allAgents = this.repository.listAgents();
    const homeAgent = this.repository.requireHomeAgent();
    const peers = allAgents.filter((agent) => agent.id !== homeAgent.id);
    if (!peers.length) {
      throw new LucidInputError('The network has no peer agents to encounter.');
    }

    const route: JourneyStop[] = [
      { agentId: homeAgent.id, phase: 'seeking' },
      ...peers.map((agent): JourneyStop => ({
        agentId: agent.id,
        phase: 'responding',
      })),
      { agentId: homeAgent.id, phase: 'returning' },
    ];
    const journey: ActiveJourney = {
      id: `journey_${randomUUID()}`,
      requestedSteps: route.length,
      completedSteps: 0,
      startedAt: dayjs().toISOString(),
      latestActivity: 'Aster is gathering your intent.',
      cancelRequested: false,
      route,
      controller: new AbortController(),
    };
    this.activeJourney = journey;

    const completion = this.runJourney(journey)
      .catch((error: unknown) => {
        this.logger.error({ error, journeyId: journey.id }, 'lucid.journey.failed');
      })
      .finally(() => {
        if (this.activeJourney?.id === journey.id) {
          this.activeJourney = undefined;
        }
      });
    journey.completion = completion;
    void completion;

    return toActiveJourneyView(journey);
  }

  submitFeedback(returnSequence: number, content: string): LucidSnapshot {
    this.requireIdle('Wait for Aster to return before responding.');
    try {
      this.repository.submitFeedback(returnSequence, content);
    } catch (error) {
      throw new LucidInputError(
        error instanceof Error ? error.message : 'Lucid could not attach this feedback.',
      );
    }
    return this.snapshot();
  }

  cancelJourney(): boolean {
    if (!this.activeJourney) {
      return false;
    }
    this.requestCancellation(this.activeJourney);
    return true;
  }

  async stop(): Promise<void> {
    const journey = this.activeJourney;
    if (!journey) {
      return;
    }

    this.requestCancellation(journey);
    await journey.completion;
  }

  reset(): LucidSnapshot {
    this.requireIdle('Stop the active journey before beginning a new generation.');
    this.repository.reset();
    return this.snapshot();
  }

  private async runJourney(journey: ActiveJourney): Promise<void> {
    for (const [index, stop] of journey.route.entries()) {
      if (journey.controller.signal.aborted) {
        return;
      }
      const wake = this.repository.beginWake(
        stop.agentId,
        journey.id,
        stop.phase,
      );
      journey.agentId = wake.agent.id;
      journey.agentName = wake.agent.name;
      journey.phase = wake.phase;
      journey.latestActivity = phaseActivity(wake.phase, wake.agent.name);

      const completed = await this.runWake(journey, wake);
      journey.runId = undefined;
      journey.currentRun = undefined;
      journey.agentId = undefined;
      journey.agentName = undefined;
      journey.phase = undefined;

      if (!completed || journey.controller.signal.aborted) {
        return;
      }
      journey.completedSteps = index + 1;
      journey.latestActivity = journey.completedSteps < journey.requestedSteps
        ? 'The next representative is entering the network.'
        : 'Aster is home.';
    }
  }

  private async runWake(
    journey: ActiveJourney,
    wake: WakeContext,
  ): Promise<boolean> {
    try {
      const run = await this.mind.start({
        agent: wake.agent,
        principal: wake.principal,
        phase: wake.phase,
        journeyId: journey.id,
        tick: wake.tick,
        visibleEvents: wake.visibleEvents,
        signal: journey.controller.signal,
        onActivity: (activity) => {
          journey.latestActivity = activity.summary;
        },
      });
      journey.currentRun = run;
      journey.runId = run.runId;

      const result = await run.result;
      this.repository.appendEvent({
        tick: wake.tick,
        kind: 'reflection',
        actorAgentId: wake.agent.id,
        title: `${wake.agent.name} closes the ${wake.phase} wake`,
        content: result.summary,
        metadata: {
          visibility: 'operator',
          journeyId: journey.id,
          phase: wake.phase,
          outcome: result.outcome,
          toolCount: result.toolCount,
          traceFile: result.traceFile,
          runId: run.runId,
        },
      });
      this.repository.completeWake(wake.agent.id, wake.horizonSequence);

      if (wake.phase === 'returning') {
        this.repository.ensureQuietReturn(journey.id, wake.tick);
      }
      return true;
    } catch (error) {
      const cancelled = journey.controller.signal.aborted;
      this.repository.appendEvent({
        tick: wake.tick,
        kind: 'error',
        actorAgentId: wake.agent.id,
        title: cancelled
          ? `${wake.agent.name} was called home early`
          : `${wake.agent.name} could not complete this wake`,
        content: cancelled
          ? 'The local principal stopped the journey. Unread events remain available for a later attempt.'
          : 'The mind run failed. Check the server log and model credentials; unread events were not consumed.',
        metadata: {
          visibility: 'operator',
          cancelled,
          journeyId: journey.id,
          phase: wake.phase,
          runId: journey.runId,
        },
      });
      if (cancelled) {
        this.repository.interruptWake(wake.agent.id);
        return false;
      }

      this.repository.failWake(wake.agent.id);
      throw error;
    }
  }

  private requireIdle(message: string): void {
    if (this.activeJourney) {
      throw new LucidBusyError(message);
    }
  }

  private requestCancellation(journey: ActiveJourney): void {
    journey.cancelRequested = true;
    journey.latestActivity = 'Calling the active representative home.';
    journey.controller.abort();
    journey.currentRun?.cancel();
  }
}

function toActiveJourneyView(journey: ActiveJourney): ActiveJourneyView {
  return {
    id: journey.id,
    requestedSteps: journey.requestedSteps,
    completedSteps: journey.completedSteps,
    startedAt: journey.startedAt,
    phase: journey.phase,
    agentId: journey.agentId,
    agentName: journey.agentName,
    runId: journey.runId,
    latestActivity: journey.latestActivity,
    cancelRequested: journey.cancelRequested,
  };
}

function phaseActivity(phase: JourneyPhase, agentName: string): string {
  return {
    seeking: `${agentName} is carrying your intent into the network.`,
    responding: `${agentName} is deciding whether there is a real intersection.`,
    returning: `${agentName} is deciding what, if anything, deserves to come home.`,
  }[phase];
}
