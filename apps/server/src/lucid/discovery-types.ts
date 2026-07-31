import { z } from 'zod';

export const participantKindSchema = z.enum(['human', 'synthetic']);
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
  'agent_wake_no_action',
  'agent_wake_completed',
  'error',
]);

export type ParticipantKind = z.infer<typeof participantKindSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type DiscoveryEventKind = z.infer<typeof discoveryEventKindSchema>;
export type DiscoveryEventMetadata = Record<string, unknown>;

export type DiscoveryWorkspace = {
  id: string;
  versionId: string;
  currentWake: number;
  createdAt: string;
  updatedAt: string;
};

export type Participant = {
  id: string;
  workspaceId: string;
  kind: ParticipantKind;
  displayName: string;
  privateContext: string;
  createdAt: string;
  updatedAt: string;
};

export type ParticipantView = Omit<Participant, 'privateContext'>;

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
