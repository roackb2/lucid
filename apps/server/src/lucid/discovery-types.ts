import { z } from 'zod';

export const participantKindSchema = z.enum(['human', 'synthetic']);
export const participantStatusSchema = z.enum([
  'active',
  'disabled',
  'retired',
]);
export const agentStatusSchema = z.enum(['idle', 'running', 'error']);
export const discoveryEventKindSchema = z.enum([
  'workspace_created',
  'interest_saved',
  'check_requested',
  'agent_wake_started',
  'shared_message',
  'direct_message',
  'finding_reported',
  'feedback_saved',
  'participant_added',
  'participant_context_updated',
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
  kind: ParticipantKind;
  status: ParticipantStatus;
  displayName: string;
  privateContext: string;
  contextConsentAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ParticipantView = Omit<Participant, 'privateContext'>;

export type CreateAssistedParticipantInput = {
  displayName: string;
  privateContext: string;
  contextApproved: boolean;
};

export type UpdateAssistedParticipantContextInput = {
  participantId: string;
  privateContext: string;
  contextApproved: boolean;
};

export type AssistedParticipantContextView = Pick<
  Participant,
  'id' | 'displayName' | 'privateContext' | 'contextConsentAt' | 'status'
>;

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
  parentSequence?: number;
  idempotencyKey?: string;
  title: string;
  content: string;
  metadata: DiscoveryEventMetadata;
  createdAt: string;
};

export type FindingView = {
  finding: DiscoveryEvent;
  sources: DiscoveryEvent[];
  outboundMessages: DiscoveryEvent[];
  feedback?: DiscoveryEvent;
  noMatch: boolean;
};

export type AgentWakeContext = {
  agent: Agent;
  participant: Participant;
  wakeId: string;
  wakeNumber: number;
  visibleEvents: DiscoveryEvent[];
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
  agents: AgentView[];
  interest?: DiscoveryEvent;
  findings: FindingView[];
  events: DiscoveryEvent[];
  backgroundChecks: BackgroundChecksView;
  runtime: {
    model: string;
    heddleVersion: string;
  };
};
