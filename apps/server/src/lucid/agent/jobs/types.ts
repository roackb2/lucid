import { z } from 'zod';
import type { Agent, User } from '../../discovery-types.js';

export const agentJobKindSchema = z.enum([
  'interest-discovery',
  'information-network-publishing',
]);

export const agentJobScheduleModeSchema = z.enum([
  'manual',
  'scheduled',
]);

export const agentJobRunRequestStateSchema = z.enum([
  'requested',
  'claimed',
  'settled',
]);

export const agentJobRunOutcomeSchema = z.enum([
  'published',
  'no-post',
  'failed',
]);

export type AgentJobKind = z.infer<typeof agentJobKindSchema>;
export type AgentJobScheduleMode = z.infer<
  typeof agentJobScheduleModeSchema
>;
export type AgentJobRunRequestState = z.infer<
  typeof agentJobRunRequestStateSchema
>;
export type AgentJobRunOutcome = z.infer<typeof agentJobRunOutcomeSchema>;

/** Private, job-owned direction supplied only to its representative Agent. */
export type AgentJobPublishingPreferences = {
  topics: string[];
  region?: string;
  intendedAudience?: string;
  tone?: string;
  sourceGuidance?: string;
  updatedAt: string;
};

/** One durable unit of recurring or explicitly requested Agent work. */
export type AgentJob = {
  id: string;
  workspaceId: string;
  agentId: string;
  kind: AgentJobKind;
  name: string;
  instructions: string;
  cadenceMs: number;
  enabled: boolean;
  scheduleMode: AgentJobScheduleMode;
  publishingPreferences?: AgentJobPublishingPreferences;
  createdAt: string;
  updatedAt: string;
};

/**
 * Durable intent for one explicitly requested run.
 *
 * Its ID is the retry-stable work identity. `currentExecutionId` is the
 * replaceable fencing token for one provider attempt.
 */
export type AgentJobRunRequest = {
  id: string;
  agentJobId: string;
  state: AgentJobRunRequestState;
  outcome?: AgentJobRunOutcome;
  currentExecutionId?: string;
  publishedPostId?: string;
  outcomeSummary?: string;
  requestedAt: string;
  claimedAt?: string;
  settledAt?: string;
};

/** Product work atomically owned by exactly one current execution attempt. */
export type AgentJobWorkClaim = {
  job: AgentJob;
  runRequest: AgentJobRunRequest;
  agent: Agent;
  user: User;
  workId: string;
  executionId: string;
};

export type RequestAgentJobRunOnceReceipt = {
  outcome: 'requested' | 'already-requested';
  request: AgentJobRunRequest;
};
