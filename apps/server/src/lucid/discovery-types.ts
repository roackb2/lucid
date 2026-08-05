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

/**
 * Participant-scoped projection of the latest request lifecycle. It exposes
 * what this participant's own representative shared and aggregate reply
 * timing, never the global participant directory or unrelated messages.
 */
export type NetworkActivityView = {
  assignment: DiscoveryEvent;
  request?: DiscoveryEvent;
  /** All delivered first-hop messages answering the current request. */
  responseCount: number;
  /** Unique peer-authored provenance roots behind those messages. */
  originatingResponseCount: number;
  /** Unique participants who authored those provenance roots. */
  originatingParticipantCount: number;
  latestResponseAt?: string;
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

export type AgentWakeContext = {
  agent: Agent;
  participant: Participant;
  wakeId: string;
  wakeNumber: number;
  visibleEvents: DiscoveryEvent[];
  workingContext: RepresentativeWorkingContext;
  horizonSequence: number;
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
  enabled: boolean;
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
