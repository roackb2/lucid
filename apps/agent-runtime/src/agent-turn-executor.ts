import type { ConversationRunStreamItem } from '@roackb2/heddle/hosted';
import type { RuntimePublicResult } from './contracts.js';

export type AgentTurnExecutionInput = {
  scopeKey: string;
  sessionId: string;
  prompt: string;
  modelApiKey: string;
  abortSignal: AbortSignal;
};

export type AgentTurnExecutionHandle = {
  runId: string;
  result: Promise<RuntimePublicResult>;
  events(options?: {
    signal?: AbortSignal;
  }): AsyncIterable<ConversationRunStreamItem<RuntimePublicResult>>;
  cancel(): boolean;
};

/** Provider-neutral seam used by the AgentCore HTTP adapter and deterministic tests. */
export type AgentTurnExecutor = {
  start(input: AgentTurnExecutionInput): Promise<AgentTurnExecutionHandle>;
};
