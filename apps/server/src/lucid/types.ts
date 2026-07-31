import { z } from 'zod';

export const principalKindSchema = z.enum(['human', 'synthetic']);
export const agentStatusSchema = z.enum(['resting', 'waking', 'error']);
export const journeyPhaseSchema = z.enum(['seeking', 'responding', 'returning']);
export const networkEventKindSchema = z.enum([
  'origin',
  'intent',
  'wake',
  'shared_post',
  'direct_message',
  'return',
  'feedback',
  'rest',
  'reflection',
  'error',
]);

export type PrincipalKind = z.infer<typeof principalKindSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type JourneyPhase = z.infer<typeof journeyPhaseSchema>;
export type NetworkEventKind = z.infer<typeof networkEventKindSchema>;
export type NetworkEventMetadata = Record<string, unknown>;

export type NetworkState = {
  id: string;
  generation: string;
  currentTick: number;
  createdAt: string;
  updatedAt: string;
};

export type Principal = {
  id: string;
  networkId: string;
  kind: PrincipalKind;
  displayName: string;
  privateContext: string;
  createdAt: string;
  updatedAt: string;
};

export type PrincipalView = Omit<Principal, 'privateContext'>;

export type Agent = {
  id: string;
  networkId: string;
  principalId: string;
  sortOrder: number;
  name: string;
  role: string;
  sigil: string;
  color: string;
  purpose: string;
  persona: string;
  conversationId: string;
  status: AgentStatus;
  wakeCount: number;
  lastSeenSequence: number;
  lastAwakeAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentView = Omit<
  Agent,
  'persona' | 'conversationId' | 'lastSeenSequence'
> & {
  principal: PrincipalView;
  unreadCount: number;
  isHomeAgent: boolean;
};

export type NetworkEvent = {
  sequence: number;
  id: string;
  networkId: string;
  tick: number;
  kind: NetworkEventKind;
  actorAgentId?: string;
  targetAgentId?: string;
  targetPrincipalId?: string;
  parentSequence?: number;
  title: string;
  content: string;
  metadata: NetworkEventMetadata;
  createdAt: string;
};

export type ReturnView = {
  event: NetworkEvent;
  sources: NetworkEvent[];
  disclosures: NetworkEvent[];
  feedback?: NetworkEvent;
  quiet: boolean;
};

export type WakeContext = {
  agent: Agent;
  principal: Principal;
  phase: JourneyPhase;
  journeyId: string;
  tick: number;
  visibleEvents: NetworkEvent[];
  horizonSequence: number;
};

export type ActiveJourneyView = {
  id: string;
  requestedSteps: number;
  completedSteps: number;
  startedAt: string;
  phase?: JourneyPhase;
  agentId?: string;
  agentName?: string;
  runId?: string;
  latestActivity: string;
  cancelRequested: boolean;
};

export type LucidSnapshot = {
  network: NetworkState;
  principal: PrincipalView;
  agents: AgentView[];
  intent?: NetworkEvent;
  returns: ReturnView[];
  events: NetworkEvent[];
  activeJourney?: ActiveJourneyView;
  runtime: {
    model: string;
    heddleVersion: string;
  };
};

export type MindActivity = {
  type: string;
  summary: string;
  timestamp: string;
};

export type AgentMindResult = {
  outcome: string;
  summary: string;
  traceFile?: string;
  toolCount: number;
};

export type AgentMindRun = {
  runId: string;
  result: Promise<AgentMindResult>;
  cancel(): boolean;
};

export type StartAgentMindInput = {
  agent: Agent;
  principal: Principal;
  phase: JourneyPhase;
  journeyId: string;
  tick: number;
  visibleEvents: NetworkEvent[];
  signal: AbortSignal;
  onActivity?(activity: MindActivity): void;
};

export interface AgentMind {
  start(input: StartAgentMindInput): Promise<AgentMindRun>;
}
