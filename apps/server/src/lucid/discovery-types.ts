import { z } from 'zod';

export const participantKindSchema = z.enum(['human', 'synthetic']);
export const agentStatusSchema = z.enum(['idle', 'running', 'error']);
export const discoveryRunPhaseSchema = z.enum([
  'requesting',
  'responding',
  'reporting',
]);
export const discoveryEventKindSchema = z.enum([
  'workspace_created',
  'interest_saved',
  'agent_step_started',
  'shared_message',
  'direct_message',
  'finding_reported',
  'feedback_saved',
  'no_action',
  'agent_step_completed',
  'error',
]);

export type ParticipantKind = z.infer<typeof participantKindSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type DiscoveryRunPhase = z.infer<typeof discoveryRunPhaseSchema>;
export type DiscoveryEventKind = z.infer<typeof discoveryEventKindSchema>;
export type DiscoveryEventMetadata = Record<string, unknown>;

export type DiscoveryWorkspace = {
  id: string;
  versionId: string;
  currentStep: number;
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
  conversationId: string;
  status: AgentStatus;
  runCount: number;
  lastSeenSequence: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentView = Omit<
  Agent,
  'instructions' | 'conversationId' | 'lastSeenSequence'
> & {
  participant: ParticipantView;
  unreadCount: number;
  isUserAgent: boolean;
};

export type DiscoveryEvent = {
  sequence: number;
  id: string;
  workspaceId: string;
  stepNumber: number;
  kind: DiscoveryEventKind;
  actorAgentId?: string;
  targetAgentId?: string;
  targetParticipantId?: string;
  parentSequence?: number;
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

export type AgentStepContext = {
  agent: Agent;
  participant: Participant;
  phase: DiscoveryRunPhase;
  discoveryRunId: string;
  stepNumber: number;
  visibleEvents: DiscoveryEvent[];
  horizonSequence: number;
};

export type ActiveDiscoveryRunView = {
  id: string;
  totalSteps: number;
  completedSteps: number;
  startedAt: string;
  phase?: DiscoveryRunPhase;
  agentId?: string;
  agentName?: string;
  agentExecutionId?: string;
  latestActivity: string;
  cancelRequested: boolean;
};

export type DiscoveryWorkspaceSnapshot = {
  workspace: DiscoveryWorkspace;
  user: ParticipantView;
  agents: AgentView[];
  interest?: DiscoveryEvent;
  findings: FindingView[];
  events: DiscoveryEvent[];
  activeRun?: ActiveDiscoveryRunView;
  runtime: {
    model: string;
    heddleVersion: string;
  };
};

export type AgentRunActivity = {
  type: string;
  summary: string;
  timestamp: string;
};

export type AgentRunResult = {
  outcome: string;
  summary: string;
  traceFile?: string;
  toolCount: number;
};

export type AgentRunHandle = {
  executionId: string;
  result: Promise<AgentRunResult>;
  cancel(): boolean;
};

export type StartAgentRunInput = {
  agent: Agent;
  participant: Participant;
  phase: DiscoveryRunPhase;
  discoveryRunId: string;
  stepNumber: number;
  visibleEvents: DiscoveryEvent[];
  signal: AbortSignal;
  onActivity?(activity: AgentRunActivity): void;
};

export interface AgentRunner {
  startAgentStep(input: StartAgentRunInput): Promise<AgentRunHandle>;
}
