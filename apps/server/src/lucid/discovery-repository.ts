import type {
  Agent,
  AgentStepContext,
  AgentView,
  DiscoveryEvent,
  DiscoveryEventKind,
  DiscoveryEventMetadata,
  DiscoveryRunPhase,
  DiscoveryWorkspace,
  FindingView,
  Participant,
  ParticipantView,
} from './discovery-types.js';

export type AppendDiscoveryEventInput = {
  stepNumber?: number;
  kind: DiscoveryEventKind;
  actorAgentId?: string;
  targetAgentId?: string;
  targetParticipantId?: string;
  parentSequence?: number;
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
  reset(): Promise<void>;
  readSnapshot(): Promise<DiscoveryRepositorySnapshot>;
  listParticipants(): Promise<Participant[]>;
  listAgents(): Promise<Agent[]>;
  requireParticipant(id: string): Promise<Participant>;
  requireAgent(id: string): Promise<Agent>;
  requireUserAgent(): Promise<Agent>;
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
  ): Promise<DiscoveryEvent[]>;
  readVisibleEventsBySequence(
    agentId: string,
    sequences: number[],
  ): Promise<DiscoveryEvent[]>;

  /**
   * Atomically records the next step and marks its agent running while
   * returning a fixed unread-event horizon for the model turn.
   */
  beginAgentStep(
    agentId: string,
    discoveryRunId: string,
    phase: DiscoveryRunPhase,
  ): Promise<AgentStepContext>;
  completeAgentStep(
    agentId: string,
    horizonSequence: number,
  ): Promise<void>;
  failAgentStep(agentId: string): Promise<void>;
  interruptAgentStep(agentId: string): Promise<void>;
  hasFindingForRun(discoveryRunId: string): Promise<boolean>;
  ensureNoFindingResult(
    discoveryRunId: string,
    stepNumber: number,
  ): Promise<DiscoveryEvent>;

  /**
   * Appends one immutable event and returns its storage-assigned sequence.
   */
  appendEvent(input: AppendDiscoveryEventInput): Promise<DiscoveryEvent>;
}
