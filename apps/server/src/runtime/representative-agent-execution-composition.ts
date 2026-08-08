import type { LucidConfig } from '../config.js';
import type {
  RepresentativeWakeRepository,
} from '../lucid/representative/repository.js';
import type { LucidLogger } from '../logger.js';
import {
  LongLivedRepresentativeAgentExecutionHost,
  TargetedRepresentativeAgentExecutionHost,
  type RepresentativeAgentExecutionHost,
  type RepresentativeHeartbeatTaskAuthority,
} from './representative-agent-execution-host.js';
import { RepresentativeAgentWorker } from './representative-agent-worker.js';

export type RepresentativeAgentExecutionCompositionOptions = {
  config: LucidConfig;
  repository: RepresentativeWakeRepository;
  taskAuthority: RepresentativeHeartbeatTaskAuthority;
  taskIdPrefix: string;
  logger: LucidLogger;
};

/** Selects and wires the configured execution topology at the process root. */
export function createRepresentativeAgentExecutionHost(
  options: RepresentativeAgentExecutionCompositionOptions,
): RepresentativeAgentExecutionHost {
  const {
    config,
    repository,
    taskAuthority,
    taskIdPrefix,
    logger,
  } = options;
  if (config.heartbeatHost === 'scheduler') {
    return new LongLivedRepresentativeAgentExecutionHost({
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

  return new TargetedRepresentativeAgentExecutionHost({
    authority: taskAuthority,
    createTarget: (handler) => new RepresentativeAgentWorker({
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
      await repository.readWorkspace()
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
