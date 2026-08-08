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

export type DiscoveryWorkspaceRepositorySnapshot = {
  workspace: DiscoveryWorkspace;
  user: ParticipantView;
  representative: AgentView;
  interest?: DiscoveryEvent;
  workingNote?: DiscoveryEvent;
  networkActivity?: NetworkActivityView;
  guidanceFollowThrough?: GuidanceFollowThroughView;
  findings: FindingView[];
};

export interface DiscoveryWorkspaceRepository {
  readSnapshot(): Promise<DiscoveryWorkspaceRepositorySnapshot>;
  requireUserAgent(): Promise<Agent>;
  findSavedInterest(): Promise<DiscoveryEvent | undefined>;
  saveInterest(content: string): Promise<DiscoveryEvent>;
  saveFeedback(
    participantId: string,
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryEvent>;
  saveGuidance(content: string): Promise<DiscoveryEvent>;
  readRepresentativeWorkingContext(
    agentId: string,
    throughSequence: number,
  ): Promise<RepresentativeWorkingContext>;
  appendEvent(input: AppendDiscoveryEventInput): Promise<DiscoveryEvent>;
}
