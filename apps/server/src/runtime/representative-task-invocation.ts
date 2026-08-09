import type { RunHeartbeatTaskResult } from '@roackb2/heddle/advanced';

/**
 * One host-routed delivery of a durable representative task.
 *
 * `runRequestGeneration` is correlation metadata for the local dispatcher.
 * Heddle still resolves and atomically claims the current durable generation
 * from its task store.
 */
export type RepresentativeTaskInvocation = {
  taskId: string;
  invocationId: string;
  runRequestGeneration?: number;
  signal: AbortSignal;
};

/**
 * Internal boundary between Lucid's dispatcher and one local task worker.
 * This shape is not a remote wire contract: `AbortSignal` is process-local and
 * the worker requires Heddle's task authority plus Lucid's handler closure.
 */
export interface RepresentativeTaskInvocationTarget {
  invoke(
    invocation: RepresentativeTaskInvocation,
  ): Promise<RunHeartbeatTaskResult>;
}
