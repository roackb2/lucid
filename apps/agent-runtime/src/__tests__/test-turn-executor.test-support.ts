import type { ConversationRunStreamItem } from '@roackb2/heddle/hosted';
import type {
  AgentTurnExecutionHandle,
  AgentTurnExecutionInput,
  AgentTurnExecutor,
} from '../agent-turn-executor.js';
import type { RuntimePublicResult } from '../contracts.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

export class TestTurnHandle implements AgentTurnExecutionHandle {
  readonly runId: string;
  readonly result: Promise<RuntimePublicResult>;
  cancelCalls = 0;
  private readonly resultDeferred = deferred<RuntimePublicResult>();
  private readonly buffer = new AsyncBuffer<ConversationRunStreamItem<RuntimePublicResult>>();
  private settled = false;

  constructor(runId: string) {
    this.runId = runId;
    this.result = this.resultDeferred.promise;
  }

  events(): AsyncIterable<ConversationRunStreamItem<RuntimePublicResult>> {
    return this.buffer.read();
  }

  cancel(): boolean {
    this.cancelCalls += 1;
    if (this.settled) {
      return false;
    }
    this.settled = true;
    this.buffer.push({
      runId: this.runId,
      sequence: 1,
      timestamp: new Date(0).toISOString(),
      kind: 'cancelled',
      reason: 'Cancelled by test',
    });
    this.buffer.close();
    this.resultDeferred.reject(new Error('Cancelled by test'));
    return true;
  }

  activity(sequence = 1): void {
    this.buffer.push({
      runId: this.runId,
      sequence,
      timestamp: new Date(sequence * 1_000).toISOString(),
      kind: 'activity',
      activity: { type: 'test.activity', sequence },
    });
  }

  finish(result: RuntimePublicResult = { outcome: 'done', summary: 'Finished' }): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.buffer.push({
      runId: this.runId,
      sequence: 2,
      timestamp: new Date(2_000).toISOString(),
      kind: 'result',
      result,
    });
    this.buffer.close();
    this.resultDeferred.resolve(result);
  }
}

export class TestTurnExecutor implements AgentTurnExecutor {
  readonly inputs: AgentTurnExecutionInput[] = [];
  readonly handles: TestTurnHandle[] = [];

  async start(input: AgentTurnExecutionInput): Promise<TestTurnHandle> {
    this.inputs.push(input);
    const handle = new TestTurnHandle(`test-run-${this.handles.length + 1}`);
    this.handles.push(handle);
    return handle;
  }

  latest(): TestTurnHandle {
    const handle = this.handles.at(-1);
    if (!handle) {
      throw new Error('No test turn has started.');
    }
    return handle;
  }
}

class AsyncBuffer<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) {
      throw new Error('Cannot push to a closed test buffer.');
    }
    this.items.push(item);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  async *read(): AsyncIterable<T> {
    while (!this.closed || this.items.length > 0) {
      if (this.items.length === 0) {
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        continue;
      }
      const item = this.items.shift();
      if (item !== undefined) {
        yield item;
      }
    }
  }

  private wake(): void {
    this.waiters.splice(0).forEach((resolve) => resolve());
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
