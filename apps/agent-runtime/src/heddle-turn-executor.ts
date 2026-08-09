import {
  ToolApprovalPolicies,
  createConversationEngine,
  type RuntimeToolSelectionProfile,
} from '@roackb2/heddle';
import { ConversationRunService } from '@roackb2/heddle/hosted';
import type { RuntimeConfig } from './config.js';
import type {
  AgentTurnExecutionHandle,
  AgentTurnExecutionInput,
  AgentTurnExecutor,
} from './agent-turn-executor.js';
import type { RuntimePublicResult } from './contracts.js';

const WORKSTATION_TOOL_PROFILE: RuntimeToolSelectionProfile = {
  preset: 'custom',
  allowedCapabilities: [
    'workspace.read',
    'workspace.write',
    'shell.inspect',
    'shell.mutate',
    'artifact.read',
    'artifact.write',
    'external.read',
    'internal.state',
  ],
  deniedCapabilities: [
    'memory.read',
    'memory.write',
    'browser.read',
    'browser.action',
    'mcp.unknown',
  ],
  memoryMode: 'none',
};

/**
 * Owns the concrete Heddle conversation engine used inside one isolated
 * runtime process. Product persistence and tenant authorization stay outside.
 */
export class HeddleTurnExecutor implements AgentTurnExecutor {
  private readonly runs = new ConversationRunService({
    replay: {
      maxEventsPerRun: 512,
      retentionMs: 5 * 60_000,
    },
  });

  constructor(private readonly config: RuntimeConfig) {}

  async start(input: AgentTurnExecutionInput): Promise<AgentTurnExecutionHandle> {
    const engine = createConversationEngine({
      workspaceRoot: this.config.workspaceRoot,
      stateRoot: this.config.stateRoot,
      model: this.config.model,
      apiKey: input.modelApiKey,
      preferApiKey: true,
      apiKeyPresent: true,
      systemContext: [
        'You are operating inside a tenant-isolated, ephemeral Linux workstation.',
        `Use ${this.config.workspaceRoot} for task files and treat ${this.config.stateRoot} as framework-owned state.`,
        'Use shell and file tools when they make the result more reliable and inspectable.',
        'Never search for credentials, runtime metadata, or data outside the assigned task.',
      ].join(' '),
      memoryMaintenanceMode: 'none',
      toolProfile: WORKSTATION_TOOL_PROFILE,
      approvalPolicies: [ToolApprovalPolicies.unattendedLocalAutomation()],
    });

    await engine.sessions.ensure({
      id: input.sessionId,
      name: 'Isolated hosted workstation',
    });

    return this.runs.startTurn({
      address: {
        scopeId: input.scopeKey,
        sessionId: input.sessionId,
      },
      engine,
      turn: {
        sessionId: input.sessionId,
        prompt: input.prompt,
        abortSignal: input.abortSignal,
        maxSteps: this.config.maxSteps,
        maxToolConcurrency: 1,
        includePlanTool: true,
        memoryMaintenanceMode: 'none',
      },
      projectResult: (result): RuntimePublicResult => ({
        outcome: parseOutcome(result.outcome),
        summary: result.summary,
        ...(result.failure ? { failure: result.failure } : {}),
      }),
      projectError: () => ({
        code: 'agent_turn_failed',
        message: 'The hosted agent turn could not complete.',
      }),
    });
  }
}

function parseOutcome(outcome: string): RuntimePublicResult['outcome'] {
  if (
    outcome === 'done'
    || outcome === 'max_steps'
    || outcome === 'error'
    || outcome === 'interrupted'
  ) {
    return outcome;
  }
  throw new Error(`Unsupported Heddle turn outcome: ${outcome}`);
}
