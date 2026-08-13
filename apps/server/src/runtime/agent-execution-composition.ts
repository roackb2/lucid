import type { LucidConfig } from '../config.js';
import type { AgentWakeStore } from '../lucid/agent/store.js';
import type { LucidLogger } from '../logger.js';
import {
  LongLivedAgentExecutionHost,
  TargetedAgentExecutionHost,
  type AgentExecutionHost,
  type AgentHeartbeatTaskAuthority,
} from './agent-execution-host.js';
import { AgentWorker } from './agent-worker.js';

export type AgentExecutionCompositionOptions = {
  config: LucidConfig;
  store: AgentWakeStore;
  taskAuthority: AgentHeartbeatTaskAuthority;
  taskIdPrefix: string;
  logger: LucidLogger;
};

/** Selects and wires the configured execution topology at the process root. */
export function createAgentExecutionHost(
  options: AgentExecutionCompositionOptions,
): AgentExecutionHost {
  const {
    config,
    store,
    taskAuthority,
    taskIdPrefix,
    logger,
  } = options;
  if (config.heartbeatHost === 'scheduler') {
    return new LongLivedAgentExecutionHost({
      authority: taskAuthority,
      workspaceRoot: config.repoRoot,
      stateRoot: config.heddleStateRoot,
      preferApiKey: config.preferApiKey,
      model: config.model,
      maxSteps: config.maxSteps,
      pollIntervalMs: config.heartbeatPollMs,
      maxConcurrentTasks: config.heartbeatMaxConcurrency,
      onEvent: (event) => logger.debug({
        eventType: event.type,
        taskId: 'taskId' in event ? event.taskId : undefined,
      }, 'lucid.heartbeat_scheduler.activity'),
      onError: (error) => logger.error(
        { error },
        'lucid.heartbeat_scheduler.failed',
      ),
    });
  }

  return new TargetedAgentExecutionHost({
    authority: taskAuthority,
    createTarget: (handler) => new AgentWorker({
      store: taskAuthority,
      handler,
      runtime: {
        workspaceRoot: config.repoRoot,
        stateDir: config.heddleStateRoot,
        preferApiKey: config.preferApiKey,
        model: config.model,
        maxSteps: config.maxSteps,
      },
      onEvent: (event) => logger.debug({
        eventType: event.type,
        taskId: 'taskId' in event ? event.taskId : undefined,
      }, 'lucid.heartbeat_worker.activity'),
    }),
    taskIdPrefix,
    pollIntervalMs: config.heartbeatPollMs,
    maxConcurrentInvocations: config.heartbeatMaxConcurrency,
    invocationTimeoutMs: config.heartbeatInvocationTimeoutMs,
    recoveryIntervalMs: config.heartbeatRecoveryIntervalMs,
    isGloballyEnabled: async () => (
      await store.readWorkspace()
    ).backgroundChecksEnabled,
    onOutcome: ({ taskId, invocationId, result, decision }) => logger.debug({
      taskId,
      invocationId,
      status: result.status,
      dispatchDecision: decision.kind,
    }, 'lucid.heartbeat_dispatch.completed'),
    onError: ({ phase, error, taskId, invocationId }) => logger.error({
      phase,
      error,
      taskId,
      invocationId,
    }, 'lucid.heartbeat_dispatch.failed'),
    onRecoveryError: (error) => logger.error(
      { error },
      'lucid.heartbeat_recovery.failed',
    ),
  });
}
