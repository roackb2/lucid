import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import type { AgentJobStore } from './store.js';
import type {
  AgentJob,
  AgentJobRunOutcome,
  AgentJobRunRequest,
  AgentJobWorkClaim,
  RequestAgentJobRunOnceReceipt,
} from './types.js';

export class AgentJobInputError extends Error {
  readonly name = 'AgentJobInputError';
}

type AgentJobServiceOptions = {
  createId?: () => string;
  now?: () => string;
};

/** Application boundary for durable Agent-job configuration and run intent. */
export class AgentJobService {
  readonly #createId: () => string;
  readonly #now: () => string;

  constructor(
    private readonly store: AgentJobStore,
    options: AgentJobServiceOptions = {},
  ) {
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? (() => dayjs().toISOString());
  }

  /**
   * Ensures the legacy Interest workflow has one stable job definition.
   * The Agent ID remains the job ID so existing hosted task IDs do not change.
   */
  async ensureInterestDiscoveryJob(
    agentId: string,
    cadenceMs: number,
  ): Promise<AgentJob> {
    if (!Number.isSafeInteger(cadenceMs) || cadenceMs < 10_000) {
      throw new AgentJobInputError(
        'Interest-discovery cadence must be an integer of at least 10000 milliseconds.',
      );
    }
    return await this.store.ensureInterestDiscoveryJob({
      agentId: normalizeIdentifier(agentId, 'Agent ID'),
      cadenceMs,
      createdAt: this.#now(),
    });
  }

  async listAgentJobs(): Promise<AgentJob[]> {
    return await this.store.listAgentJobs();
  }

  async readAgentJob(agentJobId: string): Promise<AgentJob | undefined> {
    return await this.store.readAgentJob(normalizeIdentifier(
      agentJobId,
      'Agent job ID',
    ));
  }

  async readLatestRunRequest(
    agentJobId: string,
  ): Promise<AgentJobRunRequest | undefined> {
    return await this.store.readLatestRunRequest(normalizeIdentifier(
      agentJobId,
      'Agent job ID',
    ));
  }

  async requestRunOnce(
    agentJobId: string,
  ): Promise<RequestAgentJobRunOnceReceipt> {
    return await this.store.requestRunOnce({
      agentJobId: normalizeIdentifier(agentJobId, 'Agent job ID'),
      runRequestId: `agent-job-run_${this.#createId()}`,
      requestedAt: this.#now(),
    });
  }

  async claimPendingRun(input: {
    agentJobId: string;
    executionId: string;
    interruptedExecutionId?: string;
  }): Promise<AgentJobWorkClaim | undefined> {
    return await this.store.claimPendingRun({
      agentJobId: normalizeIdentifier(input.agentJobId, 'Agent job ID'),
      executionId: normalizeIdentifier(input.executionId, 'Execution ID'),
      interruptedExecutionId: input.interruptedExecutionId
        ? normalizeIdentifier(input.interruptedExecutionId, 'Execution ID')
        : undefined,
      claimedAt: this.#now(),
    });
  }

  async readClaimedRun(
    agentJobId: string,
    executionId: string,
  ): Promise<AgentJobWorkClaim | undefined> {
    return await this.store.readClaimedRun(
      normalizeIdentifier(agentJobId, 'Agent job ID'),
      normalizeIdentifier(executionId, 'Execution ID'),
    );
  }

  async settleRun(input: {
    agentJobId: string;
    executionId: string;
    outcome: Exclude<AgentJobRunOutcome, 'failed'>;
    publishedPostId?: string;
    outcomeSummary?: string;
  }): Promise<void> {
    const publishedPostId = input.publishedPostId
      ? normalizeIdentifier(input.publishedPostId, 'Published Post ID')
      : undefined;
    if (
      (input.outcome === 'published') !== (publishedPostId !== undefined)
    ) {
      throw new AgentJobInputError(
        'A published Agent job run must identify exactly one published Post.',
      );
    }
    await this.store.settleRun({
      agentJobId: normalizeIdentifier(input.agentJobId, 'Agent job ID'),
      executionId: normalizeIdentifier(input.executionId, 'Execution ID'),
      outcome: input.outcome,
      publishedPostId,
      outcomeSummary: normalizeOptionalText(
        input.outcomeSummary,
        'Outcome summary',
        2_000,
      ),
      settledAt: this.#now(),
    });
  }

  async failRun(input: {
    agentJobId: string;
    executionId: string;
    summary: string;
  }): Promise<void> {
    await this.store.failRun({
      agentJobId: normalizeIdentifier(input.agentJobId, 'Agent job ID'),
      executionId: normalizeIdentifier(input.executionId, 'Execution ID'),
      outcomeSummary: normalizeRequiredText(
        input.summary,
        'Outcome summary',
        2_000,
      ),
      settledAt: this.#now(),
    });
  }

  async interruptRun(input: {
    agentJobId: string;
    executionId: string;
  }): Promise<void> {
    await this.store.interruptRun({
      agentJobId: normalizeIdentifier(input.agentJobId, 'Agent job ID'),
      executionId: normalizeIdentifier(input.executionId, 'Execution ID'),
      interruptedAt: this.#now(),
    });
  }
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,255}$/.test(normalized)) {
    throw new AgentJobInputError(
      `${label} must contain 1 to 256 letters, numbers, dots, colons, underscores, or hyphens.`,
    );
  }
  return normalized;
}

function normalizeRequiredText(
  value: string,
  label: string,
  maxLength: number,
): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AgentJobInputError(
      `${label} must contain 1 to ${maxLength} characters.`,
    );
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  return value === undefined
    ? undefined
    : normalizeRequiredText(value, label, maxLength);
}
