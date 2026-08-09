import type {
  RuntimePublicResult,
  RuntimeTurnStreamItem,
} from './types.js';

export type AgentTurnExecutionInput = {
  scopeKey: string;
  executionSessionId: string;
  prompt: string;
  modelApiKey: string;
  abortSignal: AbortSignal;
};

export type AgentTurnExecutionHandle = {
  runId: string;
  result: Promise<RuntimePublicResult>;
  events(options?: {
    signal?: AbortSignal;
  }): AsyncIterable<RuntimeTurnStreamItem>;
  cancel(): boolean;
};

/** Outbound execution port owned by the runtime-session application service. */
export type AgentTurnExecutor = {
  start(input: AgentTurnExecutionInput): Promise<AgentTurnExecutionHandle>;
};
