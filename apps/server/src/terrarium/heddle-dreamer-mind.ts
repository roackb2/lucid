import dayjs from 'dayjs';
import {
  createConversationEngine,
  defineHostExtension,
  HeddleEventType,
  type ConversationActivity,
} from '@roackb2/heddle';
import {
  ConversationRunService,
} from '@roackb2/heddle/hosted';
import type { LucidConfig } from '../config.js';
import { buildDreamerSystemContext, buildWakePrompt } from './prompts.js';
import type { TerrariumRepository } from './repository.js';
import {
  type DreamerMind,
  type DreamerMindResult,
  type DreamerMindRun,
  type MindActivity,
  type StartDreamerMindInput,
} from './types.js';
import { DreamerWorldToolService } from './world-tools.js';

type DreamerRunAddress = {
  dreamerId: string;
  sessionId: string;
};

/**
 * Owns the Heddle composition boundary for a Lucid Dreamer.
 *
 * Lucid supplies persona, visible world events, and scoped world tools. Heddle
 * owns the durable conversation, model/tool loop, leases, activity stream,
 * cancellation, trace, and run result.
 */
export class HeddleDreamerMind implements DreamerMind {
  private readonly runs = new ConversationRunService<DreamerRunAddress>({
    addressKey: ({ dreamerId, sessionId }) => `${dreamerId}:${sessionId}`,
    replay: {
      maxEventsPerRun: 256,
      retentionMs: 10 * 60_000,
    },
  });

  constructor(
    private readonly repository: TerrariumRepository,
    private readonly config: LucidConfig,
  ) {}

  async start(input: StartDreamerMindInput): Promise<DreamerMindRun> {
    const tools = new DreamerWorldToolService(
      this.repository,
      input.dreamer,
      input.tick,
    );
    const toolDefinitions = tools.definitions();
    const extension = defineHostExtension({
      id: `lucid:dreamer:${input.dreamer.id}`,
      tools: toolDefinitions,
      systemContext: buildDreamerSystemContext(input.dreamer),
    });
    const engine = createConversationEngine({
      workspaceRoot: this.config.repoRoot,
      stateRoot: this.config.heddleStateRoot,
      model: this.config.model,
      reasoningEffort: 'low',
      preferApiKey: this.config.preferApiKey,
      memoryMaintenanceMode: 'none',
      toolProfile: {
        preset: 'custom',
        includeTools: toolDefinitions.map((tool) => tool.name),
        allowedCapabilities: ['internal.state'],
        memoryMode: 'none',
      },
      hostExtensions: [extension],
    });
    const session = (await engine.sessions.ensure({
      id: input.dreamer.conversationId,
      name: `${input.dreamer.name} · ${input.dreamer.archetype}`,
      model: this.config.model,
    })).session;

    const handle = this.runs.startTurn({
      address: {
        dreamerId: input.dreamer.id,
        sessionId: session.id,
      },
      engine,
      turn: {
        sessionId: session.id,
        prompt: buildWakePrompt(input.dreamer, input.tick, input.visibleEvents),
        maxSteps: this.config.maxSteps,
        maxToolConcurrency: 1,
        includePlanTool: false,
        memoryMaintenanceMode: 'none',
        abortSignal: input.signal,
        host: {
          events: {
            onActivity: (activity) => {
              const projected = projectActivity(activity);
              if (projected) {
                input.onActivity?.(projected);
              }
            },
          },
          approvals: {
            requestToolApproval: async ({ call }) => ({
              approved: false,
              reason: `Lucid does not grant unconfigured approval for ${call.tool}.`,
            }),
          },
        },
      },
      projectResult: (result): DreamerMindResult => ({
        outcome: result.outcome,
        summary: result.summary,
        traceFile: result.traceFile,
        toolCount: result.toolResults.length,
      }),
      projectError: () => ({
        code: 'dreamer_wake_failed',
        message: 'The Dreamer could not complete this wake cycle.',
      }),
    });

    const cancel = () => handle.cancel();
    const onAbort = () => cancel();
    if (input.signal.aborted) {
      cancel();
    } else {
      input.signal.addEventListener('abort', onAbort, { once: true });
    }

    return {
      runId: handle.runId,
      result: handle.result.finally(() => {
        input.signal.removeEventListener('abort', onAbort);
      }),
      cancel,
    };
  }
}

function projectActivity(activity: ConversationActivity): MindActivity | undefined {
  const timestamp = 'timestamp' in activity ? activity.timestamp : dayjs().toISOString();

  switch (activity.type) {
    case HeddleEventType.loopStarted:
      return {
        type: activity.type,
        summary: `Orienting with ${activity.model}.`,
        timestamp,
      };
    case HeddleEventType.assistantCommentary:
    case HeddleEventType.reasoningSummary:
      return activity.done && activity.text.trim()
        ? {
            type: activity.type,
            summary: activity.text.trim(),
            timestamp,
          }
        : undefined;
    case HeddleEventType.toolCalling:
      return {
        type: activity.type,
        summary: `Using ${activity.tool.replaceAll('_', ' ')}.`,
        timestamp,
      };
    case HeddleEventType.toolCompleted:
      return {
        type: activity.type,
        summary: activity.result.ok
          ? `${activity.tool.replaceAll('_', ' ')} completed.`
          : `${activity.tool.replaceAll('_', ' ')} was rejected.`,
        timestamp,
      };
    case HeddleEventType.loopFinished:
      return {
        type: activity.type,
        summary: activity.outcome === 'done'
          ? 'Returning to rest.'
          : `Wake cycle ended: ${activity.outcome}.`,
        timestamp,
      };
    default:
      return undefined;
  }
}
