import type {
  AgentJob,
  AgentJobRunOutcome,
  AgentJobRunRequest,
  AgentJobWorkClaim,
  RequestAgentJobRunOnceReceipt,
} from './types.js';

export class AgentJobNotFoundError extends Error {
  readonly name = 'AgentJobNotFoundError';

  constructor() {
    super('The requested Lucid Agent job does not exist.');
  }
}

export class AgentJobDisabledError extends Error {
  readonly name = 'AgentJobDisabledError';

  constructor() {
    super('The requested Lucid Agent job is disabled.');
  }
}

export class AgentJobClaimError extends Error {
  readonly name = 'AgentJobClaimError';

  constructor() {
    super('This execution does not own the Lucid Agent job run.');
  }
}

/** Durable product authority for Agent jobs and explicit run intent. */
export interface AgentJobStore {
  ensureInterestDiscoveryJob(input: {
    agentId: string;
    cadenceMs: number;
    createdAt: string;
  }): Promise<AgentJob>;
  listAgentJobs(): Promise<AgentJob[]>;
  readAgentJob(agentJobId: string): Promise<AgentJob | undefined>;
  readLatestRunRequest(
    agentJobId: string,
  ): Promise<AgentJobRunRequest | undefined>;
  requestRunOnce(input: {
    agentJobId: string;
    runRequestId: string;
    requestedAt: string;
  }): Promise<RequestAgentJobRunOnceReceipt>;
  claimPendingRun(input: {
    agentJobId: string;
    executionId: string;
    interruptedExecutionId?: string;
    claimedAt: string;
  }): Promise<AgentJobWorkClaim | undefined>;
  readClaimedRun(
    agentJobId: string,
    executionId: string,
  ): Promise<AgentJobWorkClaim | undefined>;
  settleRun(input: {
    agentJobId: string;
    executionId: string;
    outcome: Exclude<AgentJobRunOutcome, 'failed'>;
    publishedPostId?: string;
    outcomeSummary?: string;
    settledAt: string;
  }): Promise<void>;
  failRun(input: {
    agentJobId: string;
    executionId: string;
    outcomeSummary: string;
    settledAt: string;
  }): Promise<void>;
  interruptRun(input: {
    agentJobId: string;
    executionId: string;
    interruptedAt: string;
  }): Promise<void>;
}
