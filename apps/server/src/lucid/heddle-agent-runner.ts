import dayjs from 'dayjs';
import {
  createConversationEngine,
  defineHostExtension,
  HeddleEventType,
  type ConversationActivity,
} from '@roackb2/heddle';
import { ConversationRunService } from '@roackb2/heddle/hosted';
import type { LucidConfig } from '../config.js';
import { AgentCommunicationToolService } from './agent-communication-tools.js';
import {
  buildDiscoveryStepPrompt,
  buildHeddleToolPolicyInstructions,
  buildRepresentativeAgentInstructions,
} from './agent-prompts.js';
import type { DiscoveryEventRepository } from './discovery-event-repository.js';
import {
  type AgentRunner,
  type AgentRunResult,
  type AgentRunHandle,
  type AgentRunActivity,
  type StartAgentRunInput,
} from './discovery-types.js';

type AgentRunAddress = {
  agentId: string;
  sessionId: string;
};

/**
 * Executes one representative-agent step through Heddle.
 *
 * Lucid supplies participant context, visible discovery events, phase and
 * scoped communication tools. Heddle owns conversation persistence, model/tool
 * execution, leases, cancellation, activity and traces.
 */
export class HeddleAgentRunner implements AgentRunner {
  private readonly conversationRuns = new ConversationRunService<AgentRunAddress>({
    addressKey: ({ agentId, sessionId }) => `${agentId}:${sessionId}`,
    replay: {
      maxEventsPerRun: 256,
      retentionMs: 10 * 60_000,
    },
  });

  constructor(
    private readonly repository: DiscoveryEventRepository,
    private readonly config: LucidConfig,
  ) {}

  async startAgentStep(input: StartAgentRunInput): Promise<AgentRunHandle> {
    const tools = new AgentCommunicationToolService(
      this.repository,
      input.agent,
      input.participant,
      input.phase,
      input.discoveryRunId,
      input.stepNumber,
    );
    const toolDefinitions = tools.definitions();
    const extension = defineHostExtension({
      id: `lucid:agent:${input.agent.id}`,
      tools: toolDefinitions,
      systemContext: `${buildRepresentativeAgentInstructions(input.agent, input.participant)}

${buildHeddleToolPolicyInstructions(this.config.repoRoot)}`,
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

    const handle = this.conversationRuns.startTurn({
      address: {
        agentId: input.agent.id,
        sessionId: session.id,
      },
      engine,
      turn: {
        sessionId: session.id,
        prompt: buildDiscoveryStepPrompt(
          input.agent,
          input.phase,
          input.stepNumber,
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
      projectResult: (result): AgentRunResult => ({
        outcome: result.outcome,
        summary: result.summary,
        traceFile: result.traceFile,
        toolCount: result.toolResults.length,
      }),
      projectError: () => ({
        code: 'agent_step_failed',
        message: 'The representative agent could not complete this discovery step.',
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
      executionId: handle.runId,
      result: handle.result.finally(() => {
        input.signal.removeEventListener('abort', onAbort);
      }),
      cancel,
    };
  }
}

function projectActivity(
  activity: ConversationActivity,
): AgentRunActivity | undefined {
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
      return undefined;
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
          ? 'Agent step completed.'
          : `Agent step ended: ${activity.outcome}.`,
        timestamp,
      };
    default:
      return undefined;
  }
}
