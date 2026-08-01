/**
 * Storage port used by Lucid's product and heartbeat orchestration services.
 * The vocabulary deliberately mirrors the domain so adapters can preserve its
 * transactional mailbox and lifecycle guarantees without leaking driver types.
 */
import type {
  Agent,
  AgentWakeContext,
  AgentView,
  CreateAssistedParticipantInput,
  DiscoveryEvent,
  DiscoveryEventKind,
  DiscoveryEventMetadata,
  DiscoveryWorkspace,
  FindingView,
  Participant,
  ParticipantStatus,
  ParticipantView,
} from './discovery-types.js';

export type AppendDiscoveryEventInput = {
  wakeNumber?: number;
  kind: DiscoveryEventKind;
  actorAgentId?: string;
  targetAgentId?: string;
  targetParticipantId?: string;
  parentSequence?: number;
  idempotencyKey?: string;
  title: string;
  content: string;
  metadata?: DiscoveryEventMetadata;
};

export type DiscoveryRepositorySnapshot = {
  workspace: DiscoveryWorkspace;
  user: ParticipantView;
  agents: AgentView[];
  interest?: DiscoveryEvent;
  findings: FindingView[];
  events: DiscoveryEvent[];
};

export type ParticipantWithAgent = {
  participant: Participant;
  agent: Agent;
};

/**
 * Storage-independent port for Lucid's delegated-discovery state.
 *
 * The contract is asynchronous even though the current SQLite adapter uses
 * synchronous I/O. Remote adapters such as PostgreSQL must not leak their
 * driver, query builder, or transaction types into the domain services.
 */
export interface DiscoveryRepository {
  /**
   * Creates missing product state and recovers interrupted agent status
   * without advancing unread cursors.
   */
  initialize(): Promise<void>;

  /**
   * Replaces the active workspace generation. Adapters must perform the reset
   * and default-record insertion atomically.
   */
  reset(options: { backgroundChecksEnabled: boolean }): Promise<void>;
  readWorkspace(): Promise<DiscoveryWorkspace>;
  setBackgroundChecksEnabled(enabled: boolean): Promise<DiscoveryWorkspace>;
  readSnapshot(): Promise<DiscoveryRepositorySnapshot>;
  listParticipants(): Promise<Participant[]>;
  listAgents(): Promise<Agent[]>;
  listActiveAgents(): Promise<Agent[]>;
  requireParticipant(id: string): Promise<Participant>;
  requireAgent(id: string): Promise<Agent>;
  requireAgentByParticipantId(participantId: string): Promise<Agent>;
  requireUserAgent(): Promise<Agent>;
  createAssistedParticipant(
    input: CreateAssistedParticipantInput,
  ): Promise<ParticipantWithAgent>;
  setParticipantStatus(
    participantId: string,
    status: Extract<ParticipantStatus, 'active' | 'disabled'>,
  ): Promise<ParticipantWithAgent>;
  retireParticipant(participantId: string): Promise<ParticipantWithAgent>;
  findSavedInterest(): Promise<DiscoveryEvent | undefined>;
  saveInterest(content: string): Promise<DiscoveryEvent>;
  saveFeedback(
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryEvent>;
  listEventsVisibleToAgent(
    agentId: string,
    afterSequence: number,
    limit?: number,
    throughSequence?: number,
  ): Promise<DiscoveryEvent[]>;
  readVisibleEventsBySequence(
    agentId: string,
    sequences: number[],
  ): Promise<DiscoveryEvent[]>;

  /**
   * Atomically claims one agent wake and returns a fixed unread-event horizon.
   * A wake without unread input returns undefined without incrementing the
   * agent run count or changing its status.
   */
  beginAgentWake(
    agentId: string,
    wakeId: string,
  ): Promise<AgentWakeContext | undefined>;
  completeAgentWake(
    agentId: string,
    horizonSequence: number,
  ): Promise<void>;
  failAgentWake(agentId: string): Promise<void>;
  interruptAgentWake(agentId: string): Promise<void>;
  hasFindingUsingAnySource(sourceEventIds: number[]): Promise<boolean>;
  hasAgentContributedToCausalThread(
    agentId: string,
    sourceEventIds: number[],
    currentWakeId: string,
  ): Promise<boolean>;

  /**
   * Appends one immutable event and returns its storage-assigned sequence.
   */
  appendEvent(input: AppendDiscoveryEventInput): Promise<DiscoveryEvent>;
}
