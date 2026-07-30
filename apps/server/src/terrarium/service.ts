import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import type { LucidLogger } from '../logger.js';
import type { TerrariumRepository } from './repository.js';
import {
  type ActiveCycleView,
  type DreamerMind,
  type DreamerMindRun,
  type TerrariumSnapshot,
  type WakeContext,
} from './types.js';

type ActiveCycle = ActiveCycleView & {
  controller: AbortController;
  currentRun?: DreamerMindRun;
  completion?: Promise<void>;
};

export class TerrariumBusyError extends Error {}

/**
 * Owns the operator-facing simulation lifecycle.
 *
 * It serializes world ticks, coordinates one Heddle mind run at a time, marks
 * world cursors only after successful cognition, and keeps cancellation
 * explicit. It does not interpret model output or store Heddle transcripts.
 */
export class DreamTerrariumService {
  private activeCycle?: ActiveCycle;

  constructor(
    private readonly repository: TerrariumRepository,
    private readonly mind: DreamerMind,
    private readonly runtime: { model: string; heddleVersion: string },
    private readonly logger: LucidLogger,
  ) {
    this.repository.initialize();
  }

  snapshot(): TerrariumSnapshot {
    return {
      ...this.repository.readSnapshot(),
      activeCycle: this.activeCycle ? toActiveCycleView(this.activeCycle) : undefined,
      runtime: this.runtime,
    };
  }

  seed(content: string): TerrariumSnapshot {
    this.repository.seedWorld(content);
    return this.snapshot();
  }

  startCycle(steps: number): ActiveCycleView {
    if (this.activeCycle) {
      throw new TerrariumBusyError('The terrarium is already advancing.');
    }

    const cycle: ActiveCycle = {
      id: `cycle_${randomUUID()}`,
      requestedSteps: steps,
      completedSteps: 0,
      startedAt: dayjs().toISOString(),
      latestActivity: 'Choosing the next Dreamer.',
      cancelRequested: false,
      controller: new AbortController(),
    };
    this.activeCycle = cycle;

    const completion = this.runCycle(cycle)
      .catch((error: unknown) => {
        this.logger.error({ error, cycleId: cycle.id }, 'terrarium.cycle.failed');
      })
      .finally(() => {
        if (this.activeCycle?.id === cycle.id) {
          this.activeCycle = undefined;
        }
      });
    cycle.completion = completion;
    void completion;

    return toActiveCycleView(cycle);
  }

  cancelCycle(): boolean {
    if (!this.activeCycle) {
      return false;
    }

    this.requestCancellation(this.activeCycle);
    return true;
  }

  async stop(): Promise<void> {
    const cycle = this.activeCycle;
    if (!cycle) {
      return;
    }

    this.requestCancellation(cycle);
    await cycle.completion;
  }

  reset(): TerrariumSnapshot {
    if (this.activeCycle) {
      throw new TerrariumBusyError('Stop the active cycle before resetting the terrarium.');
    }
    this.repository.reset();
    return this.snapshot();
  }

  private async runCycle(cycle: ActiveCycle): Promise<void> {
    for (let step = 0; step < cycle.requestedSteps; step += 1) {
      if (cycle.controller.signal.aborted) {
        return;
      }
      const wake = this.repository.beginWake();
      cycle.dreamerId = wake.dreamer.id;
      cycle.dreamerName = wake.dreamer.name;
      cycle.latestActivity = `${wake.dreamer.name} is noticing the world.`;

      const completed = await this.runWake(cycle, wake);
      cycle.runId = undefined;
      cycle.currentRun = undefined;
      cycle.dreamerId = undefined;
      cycle.dreamerName = undefined;

      if (!completed || cycle.controller.signal.aborted) {
        return;
      }
      cycle.completedSteps += 1;
      cycle.latestActivity = cycle.completedSteps < cycle.requestedSteps
        ? 'Choosing the next Dreamer.'
        : 'The terrarium is quiet again.';
    }
  }

  private async runWake(cycle: ActiveCycle, wake: WakeContext): Promise<boolean> {
    try {
      const run = await this.mind.start({
        dreamer: wake.dreamer,
        tick: wake.tick,
        visibleEvents: wake.visibleEvents,
        signal: cycle.controller.signal,
        onActivity: (activity) => {
          cycle.latestActivity = activity.summary;
        },
      });
      cycle.currentRun = run;
      cycle.runId = run.runId;

      const result = await run.result;
      this.repository.appendEvent({
        tick: wake.tick,
        kind: 'reflection',
        actorDreamerId: wake.dreamer.id,
        title: `${wake.dreamer.name} remembers the wake`,
        content: result.summary,
        metadata: {
          outcome: result.outcome,
          toolCount: result.toolCount,
          traceFile: result.traceFile,
          runId: run.runId,
        },
      });
      this.repository.completeWake(wake.dreamer.id, wake.horizonSequence);
      return true;
    } catch (error) {
      const cancelled = cycle.controller.signal.aborted;
      this.repository.appendEvent({
        tick: wake.tick,
        kind: 'error',
        actorDreamerId: wake.dreamer.id,
        title: cancelled
          ? `${wake.dreamer.name}'s wake was interrupted`
          : `${wake.dreamer.name} could not reach the world`,
        content: cancelled
          ? 'The operator stopped the cycle. Unread events remain available for the next wake.'
          : 'The mind run failed. Check the server log and model credentials; unread events were not consumed.',
        metadata: {
          cancelled,
          runId: cycle.runId,
        },
      });
      if (cancelled) {
        this.repository.interruptWake(wake.dreamer.id);
        return false;
      }

      this.repository.failWake(wake.dreamer.id);
      throw error;
    }
  }

  private requestCancellation(cycle: ActiveCycle): void {
    cycle.cancelRequested = true;
    cycle.latestActivity = 'The operator is closing this wake cycle.';
    cycle.controller.abort();
    cycle.currentRun?.cancel();
  }
}

function toActiveCycleView(cycle: ActiveCycle): ActiveCycleView {
  return {
    id: cycle.id,
    requestedSteps: cycle.requestedSteps,
    completedSteps: cycle.completedSteps,
    startedAt: cycle.startedAt,
    dreamerId: cycle.dreamerId,
    dreamerName: cycle.dreamerName,
    runId: cycle.runId,
    latestActivity: cycle.latestActivity,
    cancelRequested: cycle.cancelRequested,
  };
}
