import {
  type AgentHeartbeatEvent,
  type AgentHeartbeatResult,
  type HeartbeatExecutionContext,
} from '@roackb2/heddle/advanced';
import type { LucidConfig } from '../config.js';
import { AgentCommunicationToolService } from './agent-communication-tools.js';
import {
  buildAgentWakePrompt,
  buildRepresentativeAgentInstructions,
} from './agent-prompts.js';
import type { DiscoveryRepository } from './discovery-repository.js';
import type { AgentWakeContext } from './discovery-types.js';

export type RunRepresentativeAgentHeartbeatInput = {
  wake: AgentWakeContext;
  execution: HeartbeatExecutionContext;
  onEvent?(event: AgentHeartbeatEvent): void;
};

export interface RepresentativeAgentHeartbeatRunner {
  run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult>;
}

/**
 * Builds the domain-owned prompt and tool set for one representative wake,
 * then hands execution back to Heddle's heartbeat context. Heddle owns
 * credentials, checkpoint continuation, approvals, cancellation, and the
 * model/tool loop; Lucid owns participant context and mailbox operations.
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
      input.wake.horizonSequence,
    ).definitions();
    return await input.execution.runAgent({
      task: buildAgentWakePrompt(
        input.wake.agent,
        input.wake.participant,
        input.wake.wakeNumber,
        input.wake.visibleEvents,
      ),
      model: this.config.model,
      reasoningEffort: 'low',
      maxSteps: this.config.maxSteps,
      maxToolConcurrency: 1,
      systemContext: buildRepresentativeAgentInstructions(
        input.wake.agent,
        input.wake.participant,
      ),
      tools,
      includeDefaultTools: false,
      includePlanTool: false,
      onEvent: input.onEvent,
    });
  }
}
