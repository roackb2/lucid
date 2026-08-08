import { z } from 'zod';

export const participantKindSchema = z.enum(['human', 'synthetic']);
export const participantStatusSchema = z.enum([
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
  'participant_input',
  'check_requested',
  'agent_wake_started',
  'shared_message',
  'direct_message',
  'finding_reported',
  'feedback_saved',
  'guidance_saved',
  'representative_note_updated',
  'participant_added',
  'participant_disabled',
  'participant_enabled',
  'participant_retired',
  'agent_wake_no_action',
  'agent_wake_completed',
  'error',
]);

export type ParticipantKind = z.infer<typeof participantKindSchema>;
export type ParticipantStatus = z.infer<typeof participantStatusSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type NetworkMessageRole = z.infer<typeof networkMessageRoleSchema>;
export type DiscoveryEventKind = z.infer<typeof discoveryEventKindSchema>;
export type DiscoveryEventMetadata = Record<string, unknown>;

export type AppendDiscoveryEventInput = {
  wakeNumber?: number;
  kind: DiscoveryEventKind;
  actorAgentId?: string;
  targetAgentId?: string;
  targetParticipantId?: string;
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

export type Participant = {
  id: string;
  workspaceId: string;
  registrationKey?: string;
  kind: ParticipantKind;
  status: ParticipantStatus;
  displayName: string;
  privateContext: string;
  contextConsentAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ParticipantView = Omit<
  Participant,
  'privateContext' | 'registrationKey'
>;

export type RegisterParticipantInput = {
  registrationKey: string;
  kind: ParticipantKind;
  displayName: string;
  privateContext: string;
  contextApproved?: boolean;
};

export type Agent = {
  id: string;
  workspaceId: string;
  participantId: string;
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
  participant: ParticipantView;
  unreadCount: number;
  isUserAgent: boolean;
};

export type DiscoveryEvent = {
  sequence: number;
  id: string;
  workspaceId: string;
  wakeNumber: number;
  kind: DiscoveryEventKind;
  actorAgentId?: string;
  targetAgentId?: string;
  targetParticipantId?: string;
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
  /** Messages the representative cited when it reported the finding. */
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
    participantId: string;
    participantDisplayName: string;
    participantKind: ParticipantKind;
  };
};

export type NetworkRequestProgressPhase =
  | 'waiting-for-network'
  | 'messages-pending-review'
  | 'finding-reported'
  | 'reviewed-without-finding';

/**
 * Participant-scoped result of one disclosed network request. The phase is
 * derived only from delivered messages, the representative's durable mailbox
 * cursor, and linked findings; it is not a model-authored status claim.
 */
export type NetworkRequestProgressView = {
  phase: NetworkRequestProgressPhase;
  /** All delivered first-hop messages answering this request. */
  responseCount: number;
  /** Delivered replies beyond the representative's durable review cursor. */
  pendingReviewCount: number;
  /** Unique peer-authored provenance roots behind the delivered messages. */
  originatingResponseCount: number;
  /** Unique participants who authored those provenance roots. */
  originatingParticipantCount: number;
  latestResponseAt?: string;
  /** Completion time of the wake that processed the latest delivered reply. */
  reviewedAt?: string;
};

/**
 * One prior request cycle for the current participant-owned assignment.
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
 * Participant-scoped projection of the latest request lifecycle. It exposes
 * what this participant's own representative shared and aggregate reply
 * progress, never the global participant directory or unrelated messages.
 */
export type NetworkActivityView = {
  assignment: DiscoveryEvent;
  request?: DiscoveryEvent;
  requestProgress?: NetworkRequestProgressView;
  /** Most recent earlier request cycles for this same saved assignment. */
  previousRequests: NetworkRequestHistoryItemView[];
};

/**
 * Participant-scoped trace of what happened after the latest guidance. The
 * guidance may be direct or attached to a finding. Every field is an existing
 * persisted event; the projection does not infer whether the representative
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
 * Bounded Lucid-owned history supplied to one representative on every wake.
 * Raw events remain authoritative; the working note is the representative's
 * replaceable interpretation of that history, not verified participant data.
 */
export type RepresentativeWorkingContext = {
  principalInputs: DiscoveryEvent[];
  findings: FindingView[];
  workingNote?: DiscoveryEvent;
};

export type AgentWakeClaim = {
  agent: Agent;
  participant: Participant;
  wakeId: string;
  claimToken: string;
  wakeNumber: number;
  visibleEvents: DiscoveryEvent[];
  horizonSequence: number;
};

export type AgentWakeContext = AgentWakeClaim & {
  workingContext: RepresentativeWorkingContext;
};

export type RepresentativeAgentTaskStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'complete'
  | 'failed';

export type RepresentativeAgentTaskView = {
  taskId: string;
  agentId: string;
  enabled: boolean;
  status: RepresentativeAgentTaskStatus;
  progress: string;
  intervalMs: number;
  nextRunAt?: string;
  lastRunAt?: string;
  lastSummary?: string;
  error?: string;
};

export type BackgroundChecksView = {
  /** Participant or network task preference, independent of the operator gate. */
  enabled: boolean;
  /** Durable service-wide admission gate controlled only by an operator. */
  dispatchEnabled: boolean;
  running: boolean;
  intervalMs: number;
  nextRunAt?: string;
  lastRunAt?: string;
  tasks: RepresentativeAgentTaskView[];
};

export type DiscoveryWorkspaceSnapshot = {
  workspace: DiscoveryWorkspace;
  user: ParticipantView;
  representative: AgentView;
  interest?: DiscoveryEvent;
  workingNote?: DiscoveryEvent;
  networkActivity?: NetworkActivityView;
  guidanceFollowThrough?: GuidanceFollowThroughView;
  findings: FindingView[];
  backgroundChecks: BackgroundChecksView;
  runtime: {
    model: string;
    heddleVersion: string;
  };
};

export type NetworkDiagnosticsSnapshot = {
  workspace: DiscoveryWorkspace;
  participants: ParticipantView[];
  agents: AgentView[];
  events: DiscoveryEvent[];
  backgroundChecks: BackgroundChecksView;
  runtime: {
    model: string;
    heddleVersion: string;
  };
};
