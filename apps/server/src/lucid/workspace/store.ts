/**
 * Persistence port for the user-facing discovery workspace.
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
  UserView,
  AgentWorkingContext,
} from '../discovery-types.js';

export type DiscoveryWorkspaceStoreSnapshot = {
  workspace: DiscoveryWorkspace;
  user: UserView;
  agent: AgentView;
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

/** Secondary projection port consumed by agent wake orchestration. */
export interface AgentWorkingContextReader {
  readAgentWorkingContext(
    agentId: string,
    throughSequence: number,
  ): Promise<AgentWorkingContext>;
}

export interface DiscoveryWorkspaceStore
extends AgentWorkingContextReader {
  readSnapshot(userId: string): Promise<DiscoveryWorkspaceStoreSnapshot>;
  requireAgentForUser(userId: string): Promise<Agent>;
  findSavedInterest(userId: string): Promise<DiscoveryEvent | undefined>;
  saveInterest(userId: string, content: string): Promise<DiscoveryEvent>;
  saveFeedback(
    userId: string,
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryEvent>;
  saveGuidance(userId: string, content: string): Promise<DiscoveryEvent>;
  recordCheckRequest(input: RecordCheckRequestInput): Promise<DiscoveryEvent>;
}
