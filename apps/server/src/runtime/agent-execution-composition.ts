import {
  HeartbeatTargetedTaskHost,
  HeartbeatTargetedTaskWorker,
  type HeartbeatTargetedTaskHostHandle,
  type HeartbeatTargetedTaskStore,
} from '@heddleagent/runtime/advanced';
import type { LucidConfig } from '../config.js';
import type { AgentWakeStore } from '../lucid/agent/store.js';
import type { LucidLogger } from '../logger.js';

export type AgentExecutionCompositionOptions = {
  config: LucidConfig;
  store: AgentWakeStore;
  taskStore: HeartbeatTargetedTaskStore;
  taskIdPrefix: string;
  logger: LucidLogger;
};

/** Wires Lucid's product gate and runtime options into Heddle's targeted host. */
export function createAgentExecutionHost(
  options: AgentExecutionCompositionOptions,
): HeartbeatTargetedTaskHostHandle {
  const {
    config,
    store,
    taskStore,
    taskIdPrefix,
    logger,
  } = options;

  return new HeartbeatTargetedTaskHost({
    store: taskStore,
    createTarget: (handler) => new HeartbeatTargetedTaskWorker({
      store: taskStore,
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
    isAdmissionEnabled: async () => (
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
