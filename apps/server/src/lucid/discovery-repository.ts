/**
 * Storage port used by Lucid's product and heartbeat orchestration services.
 * The vocabulary deliberately mirrors the domain so adapters can preserve its
 * transactional mailbox and lifecycle guarantees without leaking driver types.
 */
import type {
  Agent,
  AgentWakeContext,
  AgentView,
  DiscoveryEvent,
  DiscoveryEventKind,
  DiscoveryEventMetadata,
  DiscoveryWorkspace,
  GuidanceFollowThroughView,
  FindingView,
  NetworkActivityView,
  Participant,
  ParticipantStatus,
  ParticipantView,
  RegisterParticipantInput,
  RepresentativeWorkingContext,
} from './discovery-types.js';

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

export type DiscoveryRepositorySnapshot = {
  workspace: DiscoveryWorkspace;
  user: ParticipantView;
  representative: AgentView;
  interest?: DiscoveryEvent;
  workingNote?: DiscoveryEvent;
  networkActivity?: NetworkActivityView;
  guidanceFollowThrough?: GuidanceFollowThroughView;
  findings: FindingView[];
};

export type NetworkDiagnosticsRepositorySnapshot = {
  workspace: DiscoveryWorkspace;
  participants: ParticipantView[];
  agents: AgentView[];
  events: DiscoveryEvent[];
};

export type ParticipantWithAgent = {
  participant: Participant;
  agent: Agent;
  created?: boolean;
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
  readNetworkDiagnostics(): Promise<NetworkDiagnosticsRepositorySnapshot>;
  listParticipants(): Promise<Participant[]>;
  listAgents(): Promise<Agent[]>;
  listActiveAgents(): Promise<Agent[]>;
  requireParticipant(id: string): Promise<Participant>;
  requireAgent(id: string): Promise<Agent>;
  requireAgentByParticipantId(participantId: string): Promise<Agent>;
  requireUserAgent(): Promise<Agent>;
  registerParticipant(
    input: RegisterParticipantInput,
  ): Promise<ParticipantWithAgent>;
  setParticipantStatus(
    participantId: string,
    status: Extract<ParticipantStatus, 'active' | 'disabled'>,
  ): Promise<ParticipantWithAgent>;
  retireParticipant(participantId: string): Promise<ParticipantWithAgent>;
  findSavedInterest(): Promise<DiscoveryEvent | undefined>;
  saveInterest(content: string): Promise<DiscoveryEvent>;
  saveParticipantInput(
    participantId: string,
    content: string,
    idempotencyKey: string,
  ): Promise<DiscoveryEvent>;
  saveFeedback(
    participantId: string,
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryEvent>;
  saveGuidance(content: string): Promise<DiscoveryEvent>;
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
  readEvent(sequence: number): Promise<DiscoveryEvent | undefined>;
  listAgentWakeCommunicationEvents(
    agentId: string,
    wakeNumber: number,
  ): Promise<DiscoveryEvent[]>;

  /**
   * Returns bounded participant-owned history as it existed at one event
   * horizon. Retry callers therefore cannot observe effects written by the
   * wake they are replaying.
   */
  readRepresentativeWorkingContext(
    agentId: string,
    throughSequence: number,
  ): Promise<RepresentativeWorkingContext>;

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
  hasParticipantFindingUsingAnyOrigin(
    participantId: string,
    sourceEventIds: number[],
  ): Promise<boolean>;
  /**
   * Finds the durable network request that represents one assignment/check.
   * Returning the event lets tool retries reuse the committed side effect,
   * rather than merely treating the request prerequisite as satisfied.
   */
  findAgentPublishedRequestForTrigger(
    agentId: string,
    triggerSequence: number,
  ): Promise<DiscoveryEvent | undefined>;
  hasAgentUpdatedWorkingNoteThrough(
    agentId: string,
    sourceSequence: number,
  ): Promise<boolean>;

  /**
   * Reconstructs the communication budget for a retried wake from durable
   * events. Tool-service instances are process-local, so their counters must
   * never be the authority for retry idempotency.
   */
  countAgentWakeCommunicationActions(
    agentId: string,
    wakeNumber: number,
  ): Promise<number>;
  hasAgentContributedToRequestThread(
    agentId: string,
    replyToSequence: number,
    currentWakeId: string,
  ): Promise<boolean>;

  /**
   * Appends one immutable event and returns its storage-assigned sequence.
   */
  appendEvent(input: AppendDiscoveryEventInput): Promise<DiscoveryEvent>;
}
