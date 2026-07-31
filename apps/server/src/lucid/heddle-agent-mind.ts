import dayjs from 'dayjs';
import {
  createConversationEngine,
  defineHostExtension,
  HeddleEventType,
  type ConversationActivity,
} from '@roackb2/heddle';
import { ConversationRunService } from '@roackb2/heddle/hosted';
import type { LucidConfig } from '../config.js';
import { AgentNetworkToolService } from './network-tools.js';
import { buildAgentSystemContext, buildWakePrompt } from './prompts.js';
import type { LucidRepository } from './repository.js';
import {
  type AgentMind,
  type AgentMindResult,
  type AgentMindRun,
  type MindActivity,
  type StartAgentMindInput,
} from './types.js';

type AgentRunAddress = {
  agentId: string;
  sessionId: string;
};

/**
 * Owns the Heddle composition boundary for one delegated Lucid agent.
 *
 * Lucid supplies principal context, visible network events, journey phase and
 * scoped tools. Heddle owns durable conversation state, model/tool execution,
 * leases, cancellation, activity, trace and the final turn result.
 */
export class HeddleAgentMind implements AgentMind {
  private readonly runs = new ConversationRunService<AgentRunAddress>({
    addressKey: ({ agentId, sessionId }) => `${agentId}:${sessionId}`,
    replay: {
      maxEventsPerRun: 256,
      retentionMs: 10 * 60_000,
    },
  });

  constructor(
    private readonly repository: LucidRepository,
    private readonly config: LucidConfig,
  ) {}

  async start(input: StartAgentMindInput): Promise<AgentMindRun> {
    const tools = new AgentNetworkToolService(
      this.repository,
      input.agent,
      input.principal,
      input.phase,
      input.journeyId,
      input.tick,
    );
    const toolDefinitions = tools.definitions();
    const extension = defineHostExtension({
      id: `lucid:agent:${input.agent.id}`,
      tools: toolDefinitions,
      systemContext: buildAgentSystemContext(input.agent, input.principal),
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
      id: input.agent.conversationId,
      name: `${input.agent.name} · ${input.agent.role}`,
      model: this.config.model,
    })).session;

    const handle = this.runs.startTurn({
      address: {
        agentId: input.agent.id,
        sessionId: session.id,
      },
      engine,
      turn: {
        sessionId: session.id,
        prompt: buildWakePrompt(
          input.agent,
          input.phase,
          input.tick,
          input.visibleEvents,
        ),
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
      projectResult: (result): AgentMindResult => ({
        outcome: result.outcome,
        summary: result.summary,
        traceFile: result.traceFile,
        toolCount: result.toolResults.length,
      }),
      projectError: () => ({
        code: 'agent_wake_failed',
        message: 'The delegated agent could not complete this journey wake.',
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
          ? 'Returning from this wake.'
          : `Journey wake ended: ${activity.outcome}.`,
        timestamp,
      };
    default:
      return undefined;
  }
}
