import {
  RuntimeCredentialService,
  ToolApprovalPolicies,
  type RuntimeProviderCredential,
} from '@roackb2/heddle';
import {
  HeartbeatRunnerAgent,
  type AgentHeartbeatEvent,
  type AgentHeartbeatResult,
  type AgentLoopCheckpoint,
  type AgentLoopState,
} from '@roackb2/heddle/advanced';
import type { LucidConfig } from '../config.js';
import { AgentCommunicationToolService } from './agent-communication-tools.js';
import {
  buildAgentWakePrompt,
  buildHeddleToolPolicyInstructions,
  buildRepresentativeAgentInstructions,
} from './agent-prompts.js';
import type { DiscoveryRepository } from './discovery-repository.js';
import type { AgentWakeContext } from './discovery-types.js';

export type RunRepresentativeAgentHeartbeatInput = {
  wake: AgentWakeContext;
  checkpoint?: AgentLoopState | AgentLoopCheckpoint;
  intervalMs: number;
  signal: AbortSignal;
  onEvent?(event: AgentHeartbeatEvent): void;
};

export interface RepresentativeAgentHeartbeatRunner {
  run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult>;
}

/**
 * Executes one Lucid representative-agent wake through Heddle's autonomous
 * heartbeat runner. Heddle owns checkpoint continuation and the model/tool
 * loop; Lucid supplies participant context, mailbox events, and scoped tools.
 */
export class HeddleRepresentativeAgentRunner
implements RepresentativeAgentHeartbeatRunner {
  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly config: LucidConfig,
  ) {}

  async run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    const tools = await new AgentCommunicationToolService(
      this.repository,
      input.wake.agent,
      input.wake.participant,
      input.wake.wakeId,
      input.wake.wakeNumber,
    ).definitions();
    const credential = RuntimeCredentialService.resolveForModel(
      this.config.model,
      { preferApiKey: this.config.preferApiKey },
    );
    if (credential.source.type === 'missing') {
      throw new Error(
        RuntimeCredentialService.formatMissingCredentialMessage(
          this.config.model,
        ),
      );
    }

    return await HeartbeatRunnerAgent.run({
      task: buildAgentWakePrompt(
        input.wake.agent,
        input.wake.participant,
        input.wake.wakeNumber,
        input.wake.visibleEvents,
      ),
      checkpoint: input.checkpoint,
      runContext: {
        currentDateTime: new Date().toISOString(),
        intervalMs: input.intervalMs,
        continuationMode: 'operator',
      },
      model: this.config.model,
      reasoningEffort: 'low',
      maxSteps: this.config.maxSteps,
      maxToolConcurrency: 1,
      workspaceRoot: this.config.repoRoot,
      stateDir: this.config.heddleStateRoot,
      systemContext: `${buildRepresentativeAgentInstructions(
        input.wake.agent,
        input.wake.participant,
      )}

${buildHeddleToolPolicyInstructions(this.config.repoRoot)}`,
      tools,
      includeDefaultTools: false,
      includePlanTool: false,
      approvalPolicies: [
        ToolApprovalPolicies.unattendedLocalAutomation(),
      ],
      approveToolCall: async ({ tool }) => ({
        approved: false,
        reason:
          `Lucid heartbeat does not grant interactive approval for ${tool}.`,
      }),
      apiKey: credential.apiKey,
      credential: toRuntimeCredential(credential.credential),
      abortSignal: input.signal,
      onEvent: input.onEvent,
    });
  }
}

function toRuntimeCredential(
  credential: ReturnType<
    typeof RuntimeCredentialService.resolveForModel
  >['credential'],
): RuntimeProviderCredential | undefined {
  if (!credential) {
    return undefined;
  }
  if (credential.type === 'oauth-access-token') {
    return credential;
  }
  if (credential.provider !== 'openai') {
    throw new Error(
      `Heartbeat OAuth is not supported for provider ${credential.provider}.`,
    );
  }
  return {
    type: 'oauth-access-token',
    provider: 'openai',
    accessToken: credential.accessToken,
    expiresAt: credential.expiresAt,
    accountId: credential.accountId,
  };
}
