/**
 * Persistence port for the participant-facing discovery workspace.
 *
 * The service depends on product transactions and projections, never on
 * PostgreSQL tables, query builders, or the wider operator/runtime surface.
 */
import type {
  Agent,
  AgentView,
  AppendDiscoveryEventInput,
  DiscoveryEvent,
  DiscoveryWorkspace,
  GuidanceFollowThroughView,
  FindingView,
  NetworkActivityView,
  ParticipantView,
  RepresentativeWorkingContext,
} from '../discovery-types.js';

export type DiscoveryWorkspaceStoreSnapshot = {
  workspace: DiscoveryWorkspace;
  user: ParticipantView;
  representative: AgentView;
  interest?: DiscoveryEvent;
  workingNote?: DiscoveryEvent;
  networkActivity?: NetworkActivityView;
  guidanceFollowThrough?: GuidanceFollowThroughView;
  findings: FindingView[];
};

export type RecordCheckRequestInput = Omit<
  AppendDiscoveryEventInput,
  'kind'
>;

/** Secondary projection port consumed by representative wake orchestration. */
export interface RepresentativeWorkingContextReader {
  readRepresentativeWorkingContext(
    agentId: string,
    throughSequence: number,
  ): Promise<RepresentativeWorkingContext>;
}

export interface DiscoveryWorkspaceStore
extends RepresentativeWorkingContextReader {
  readSnapshot(): Promise<DiscoveryWorkspaceStoreSnapshot>;
  requireUserAgent(): Promise<Agent>;
  findSavedInterest(): Promise<DiscoveryEvent | undefined>;
  saveInterest(content: string): Promise<DiscoveryEvent>;
  saveFeedback(
    participantId: string,
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryEvent>;
  saveGuidance(content: string): Promise<DiscoveryEvent>;
  recordCheckRequest(input: RecordCheckRequestInput): Promise<DiscoveryEvent>;
}
