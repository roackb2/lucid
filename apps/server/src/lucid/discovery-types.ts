import { z } from 'zod';

export const userKindSchema = z.enum(['human', 'synthetic']);
export const userStatusSchema = z.enum([
  'active',
  'disabled',
  'retired',
]);
export const agentStatusSchema = z.enum(['idle', 'running', 'error']);
export const networkMessageRoleSchema = z.enum([
  'request',
  'response',
  'contribution',
]);
export const discoveryEventKindSchema = z.enum([
  'workspace_created',
  'interest_saved',
  'user_input',
  'check_requested',
  'agent_wake_started',
  'shared_message',
  'direct_message',
  'finding_reported',
  'feedback_saved',
  'guidance_saved',
  'agent_note_updated',
  'user_added',
  'user_disabled',
  'user_enabled',
  'user_retired',
  'agent_wake_no_action',
  'agent_wake_completed',
  'error',
]);

export type UserKind = z.infer<typeof userKindSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type NetworkMessageRole = z.infer<typeof networkMessageRoleSchema>;
export type DiscoveryEventKind = z.infer<typeof discoveryEventKindSchema>;
export type DiscoveryEventMetadata = Record<string, unknown>;

export type AppendDiscoveryEventInput = {
  wakeNumber?: number;
  kind: DiscoveryEventKind;
  actorAgentId?: string;
  targetAgentId?: string;
  targetUserId?: string;
  replyToSequence?: number;
  idempotencyKey?: string;
  title: string;
  content: string;
  metadata?: DiscoveryEventMetadata;
};

export type DiscoveryWorkspace = {
  id: string;
  versionId: string;
  currentWake: number;
  backgroundChecksEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  workspaceId: string;
  registrationKey?: string;
  kind: UserKind;
  status: UserStatus;
  displayName: string;
  privateContext: string;
  contextConsentAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UserView = Omit<
  User,
  'privateContext' | 'registrationKey'
>;

export type RegisterUserInput = {
  registrationKey: string;
  kind: UserKind;
  displayName: string;
  privateContext: string;
  contextApproved?: boolean;
};

export type Agent = {
  id: string;
  workspaceId: string;
  userId: string;
  sortOrder: number;
  name: string;
  role: string;
  color: string;
  purpose: string;
  instructions: string;
  status: AgentStatus;
  runCount: number;
  mailboxFloorSequence: number;
  lastSeenSequence: number;
  activeWakeId?: string;
  /** Rotates for every execution attempt while activeWakeId stays retry-stable. */
  activeWakeClaimToken?: string;
  activeWakeNumber?: number;
  activeWakeHorizon?: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentView = Omit<
  Agent,
  | 'instructions'
  | 'mailboxFloorSequence'
  | 'lastSeenSequence'
  | 'activeWakeId'
  | 'activeWakeClaimToken'
  | 'activeWakeNumber'
  | 'activeWakeHorizon'
> & {
  user: UserView;
  unreadCount: number;
  isCurrentUserAgent: boolean;
};

export type DiscoveryEvent = {
  sequence: number;
  id: string;
  workspaceId: string;
  wakeNumber: number;
  kind: DiscoveryEventKind;
  actorAgentId?: string;
  targetAgentId?: string;
  targetUserId?: string;
  /**
   * The event this event answers or continues. Content provenance remains in
   * metadata.sourceEventIds so conversation routing cannot masquerade as an
   * independent information source.
   */
  replyToSequence?: number;
  idempotencyKey?: string;
  title: string;
  content: string;
  metadata: DiscoveryEventMetadata;
  createdAt: string;
};

export type FindingView = {
  finding: DiscoveryEvent;
  /** Messages the agent cited when it reported the finding. */
  sources: FindingSourceView[];
  /**
   * Earliest peer-authored messages in the cited provenance graph. Relays are
   * deliberately excluded so propagation is not presented as corroboration.
   */
  originatingSources: FindingSourceView[];
  outboundMessages: DiscoveryEvent[];
  feedback?: DiscoveryEvent;
  noMatch: boolean;
  assignmentSequence?: number;
  origin: 'ambient-network' | 'request-thread';
};

export type FindingSourceView = {
  message: DiscoveryEvent;
  attribution?: {
    agentId: string;
    agentName: string;
    userId: string;
    userDisplayName: string;
    userKind: UserKind;
  };
};

export type NetworkRequestProgressPhase =
  | 'waiting-for-network'
  | 'messages-pending-review'
  | 'finding-reported'
  | 'reviewed-without-finding';

/**
 * User-scoped result of one disclosed network request. The phase is
 * derived only from delivered messages, the agent's durable mailbox
 * cursor, and linked findings; it is not a model-authored status claim.
 */
export type NetworkRequestProgressView = {
  phase: NetworkRequestProgressPhase;
  /** All delivered first-hop messages answering this request. */
  responseCount: number;
  /** Delivered replies beyond the agent's durable review cursor. */
  pendingReviewCount: number;
  /** Unique peer-authored provenance roots behind the delivered messages. */
  originatingResponseCount: number;
  /** Unique users who authored those provenance roots. */
  originatingUserCount: number;
  latestResponseAt?: string;
  /** Completion time of the wake that processed the latest delivered reply. */
  reviewedAt?: string;
};

/**
 * One prior request cycle for the current user-owned assignment.
 * Every field is a persisted event or a transport-derived progress view;
 * scheduled empty wakes and unrelated network activity are excluded.
 */
export type NetworkRequestHistoryItemView = {
  trigger: DiscoveryEvent;
  request: DiscoveryEvent;
  progress: NetworkRequestProgressView;
  guidance?: DiscoveryEvent;
  linkedFindings: DiscoveryEvent[];
};

/**
 * User-scoped projection of the latest request lifecycle. It exposes
 * what this user's own agent shared and aggregate reply
 * progress, never the global user directory or unrelated messages.
 */
export type NetworkActivityView = {
  assignment: DiscoveryEvent;
  request?: DiscoveryEvent;
  requestProgress?: NetworkRequestProgressView;
  /** Most recent earlier request cycles for this same saved assignment. */
  previousRequests: NetworkRequestHistoryItemView[];
};

/**
 * User-scoped trace of what happened after the latest guidance. The
 * guidance may be direct or attached to a finding. Every field is an existing
 * persisted event; the projection does not infer whether the agent
 * understood the guidance correctly.
 */
export type GuidanceFollowThroughView = {
  guidance: DiscoveryEvent;
  sourceFinding?: DiscoveryEvent;
  priorWorkingNote?: DiscoveryEvent;
  workingNote?: DiscoveryEvent;
  request?: DiscoveryEvent;
  requestProgress?: NetworkRequestProgressView;
  resultingFinding?: FindingView;
};

/**
 * Bounded Lucid-owned history supplied to one agent on every wake.
 * Raw events remain authoritative; the working note is the agent's
 * replaceable interpretation of that history, not verified user data.
 */
export type AgentWorkingContext = {
  principalInputs: DiscoveryEvent[];
  findings: FindingView[];
  workingNote?: DiscoveryEvent;
};

export type AgentWakeClaim = {
  agent: Agent;
  user: User;
  wakeId: string;
  claimToken: string;
  wakeNumber: number;
  visibleEvents: DiscoveryEvent[];
  horizonSequence: number;
};

export type AgentWakeContext = AgentWakeClaim & {
  workingContext: AgentWorkingContext;
};

/**
 * Product work bound to one Coordinator-owned execution attempt.
 * `workId` is retry-stable while `executionId` is the current fencing token.
 */
export type AgentWorkClaim = {
  agent: Agent;
  user: User;
  workId: string;
  executionId: string;
  workNumber: number;
  visibleEvents: DiscoveryEvent[];
  horizonSequence: number;
  workingContext: AgentWorkingContext;
};

export type AgentTaskStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'complete'
  | 'failed';

export type AgentTaskView = {
  taskId: string;
  agentId: string;
  enabled: boolean;
  status: AgentTaskStatus;
  progress: string;
  intervalMs: number;
  nextRunAt?: string;
  lastRunAt?: string;
  lastSummary?: string;
  error?: string;
};

export type BackgroundChecksView = {
  /** User or network task preference, independent of the operator gate. */
  enabled: boolean;
  /** Durable service-wide admission gate controlled only by an operator. */
  dispatchEnabled: boolean;
  running: boolean;
  intervalMs: number;
  nextRunAt?: string;
  lastRunAt?: string;
  tasks: AgentTaskView[];
};

export type AgentActivityKind =
  | 'working'
  | 'needs-attention'
  | 'recovered'
  | 'finding-returned'
  | 'no-new-finding'
  | 'network-request'
  | 'network-contribution'
  | 'understanding-updated'
  | 'completed';

/**
 * One bounded, product-readable summary of an Agent wake. Raw task, trace,
 * mailbox, and event identifiers remain internal.
 */
export type AgentActivityItemView = {
  id: string;
  kind: AgentActivityKind;
  title: string;
  summary: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  inputCount: number;
  findingCount: number;
};

export type DiscoveryWorkspaceSnapshot = {
  workspace: DiscoveryWorkspace;
  user: UserView;
  agent: AgentView;
  interest?: DiscoveryEvent;
  workingNote?: DiscoveryEvent;
  networkActivity?: NetworkActivityView;
  guidanceFollowThrough?: GuidanceFollowThroughView;
  findings: FindingView[];
  agentActivity: AgentActivityItemView[];
  backgroundChecks: BackgroundChecksView;
  runtime: {
    model: string;
    heddleVersion: string;
  };
};

export type NetworkDiagnosticsSnapshot = {
  workspace: DiscoveryWorkspace;
  users: UserView[];
  agents: AgentView[];
  events: DiscoveryEvent[];
  backgroundChecks: BackgroundChecksView;
  runtime: {
    model: string;
    heddleVersion: string;
  };
};
