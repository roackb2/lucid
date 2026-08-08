import {
  HeartbeatSchedulerService,
  type HeartbeatTargetedTaskStore,
  type HeartbeatTaskHandler,
  type RunHeartbeatTaskOptions,
} from '@roackb2/heddle/advanced';
import type {
  RepresentativeTaskInvocation,
  RepresentativeTaskInvocationTarget,
} from './representative-task-invocation.js';

type RepresentativeAgentWorkerExecutionOptions = Omit<
  RunHeartbeatTaskOptions,
  | 'taskId'
  | 'store'
  | 'executionOwnerId'
  | 'signal'
  | 'handler'
  | 'runner'
>;

export type RepresentativeAgentWorkerOptions =
  RepresentativeAgentWorkerExecutionOptions & {
    store: HeartbeatTargetedTaskStore;
    handler: HeartbeatTaskHandler;
  };

/**
 * Executes exactly one task already routed by Lucid's host dispatcher.
 *
 * This worker deliberately delegates direct lookup, the final due check,
 * claim fencing, checkpoints, model/tool execution, and settlement to Heddle.
 * It never scans tasks, polls for work, or performs owner recovery.
 */
export class RepresentativeAgentWorker
implements RepresentativeTaskInvocationTarget {
  constructor(
    private readonly options: RepresentativeAgentWorkerOptions,
  ) {}

  async invoke(invocation: RepresentativeTaskInvocation) {
    const { store, handler, ...executionOptions } = this.options;
    return await HeartbeatSchedulerService.runTask({
      ...executionOptions,
      store,
      handler,
      taskId: invocation.taskId,
      executionOwnerId: invocation.invocationId,
      signal: invocation.signal,
    });
  }
}
