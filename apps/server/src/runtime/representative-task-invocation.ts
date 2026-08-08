import type { RunHeartbeatTaskResult } from '@roackb2/heddle/advanced';

/**
 * One host-routed delivery of a durable representative task.
 *
 * `runRequestGeneration` is correlation metadata for dispatchers and remote
 * invocation hosts. Heddle still resolves and atomically claims the current
 * durable generation from its task store.
 */
export type RepresentativeTaskInvocation = {
  taskId: string;
  invocationId: string;
  runRequestGeneration?: number;
  signal: AbortSignal;
};

/**
 * Replaceable boundary between Lucid's dispatcher and one execution host.
 * The local target calls the worker directly; an AgentCore target can send the
 * same invocation shape to a runtime without changing dispatch policy.
 */
export interface RepresentativeTaskInvocationTarget {
  invoke(
    invocation: RepresentativeTaskInvocation,
  ): Promise<RunHeartbeatTaskResult>;
}
