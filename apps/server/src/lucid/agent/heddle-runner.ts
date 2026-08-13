import {
  type AgentHeartbeatEvent,
  type AgentHeartbeatResult,
  type HeartbeatExecutionContext,
} from '@roackb2/heddle/advanced';
import type { LucidConfig } from '../../config.js';
import { AgentCommunicationToolService } from './communication/tool-service.js';
import {
  buildAgentWakePrompt,
  buildAgentInstructions,
} from '../agent-prompts.js';
import type { AgentWakeContext } from '../discovery-types.js';
import type {
  AgentCommunicationStore,
} from './communication/store.js';

export type RunAgentHeartbeatInput = {
  wake: AgentWakeContext;
  execution: HeartbeatExecutionContext;
  onEvent?(event: AgentHeartbeatEvent): void;
};

export interface AgentHeartbeatRunner {
  run(
    input: RunAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult>;
}

/**
 * Builds the domain-owned prompt and tool set for one agent wake,
 * then hands execution back to Heddle's heartbeat context. Heddle owns
 * credentials, checkpoint continuation, approvals, cancellation, and the
 * model/tool loop; Lucid owns user context and mailbox operations.
 */
export class HeddleAgentRunner
implements AgentHeartbeatRunner {
  constructor(
    private readonly store: AgentCommunicationStore,
    private readonly config: LucidConfig,
  ) {}

  async run(
    input: RunAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    const requiredRequestSourceIds = input.wake.visibleEvents
      .filter(({ kind }) => (
        kind === 'interest_saved' || kind === 'check_requested'
      ))
      .map(({ sequence }) => sequence);
    const requiredWorkingNoteSourceIds = input.wake.visibleEvents
      .filter(({ kind }) => kind === 'guidance_saved')
      .map(({ sequence }) => sequence);
    const tools = await new AgentCommunicationToolService(
      this.store,
      input.wake.agent,
      input.wake.user,
      input.wake.wakeId,
      input.wake.wakeNumber,
      input.wake.horizonSequence,
      requiredRequestSourceIds,
      requiredWorkingNoteSourceIds,
    ).definitions();
    return await input.execution.runAgent({
      task: buildAgentWakePrompt(
        input.wake.agent,
        input.wake.user,
        input.wake.wakeNumber,
        input.wake.visibleEvents,
        input.wake.workingContext,
      ),
      model: this.config.model,
      reasoningEffort: 'low',
      maxSteps: this.config.maxSteps,
      maxToolConcurrency: 1,
      systemContext: buildAgentInstructions(
        input.wake.agent,
        input.wake.user,
      ),
      tools,
      includeDefaultTools: false,
      includePlanTool: false,
      onEvent: input.onEvent,
    });
  }
}
