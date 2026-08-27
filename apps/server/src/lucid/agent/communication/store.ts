/** Persistence port exposed to one agent's communication tools. */
import type {
  Agent,
  AppendDiscoveryEventInput,
  DiscoveryEvent,
} from '../../discovery-types.js';

export type CommunicationEventKind =
  | 'agent_note_updated'
  | 'shared_message'
  | 'direct_message'
  | 'finding_reported'
  | 'agent_wake_no_action';

export type AppendCommunicationEventInput = {
  [Kind in CommunicationEventKind]: Omit<
    AppendDiscoveryEventInput,
    'kind'
  > & { kind: Kind };
}[CommunicationEventKind];

export interface AgentCommunicationStore {
  listAgents(): Promise<Agent[]>;
  listActiveAgents(): Promise<Agent[]>;
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
  countAgentWakeCommunicationActions(
    agentId: string,
    wakeNumber: number,
  ): Promise<number>;
  findAgentPublishedRequestForTrigger(
    agentId: string,
    triggerSequence: number,
  ): Promise<DiscoveryEvent | undefined>;
  hasAgentUpdatedWorkingNoteThrough(
    agentId: string,
    sourceSequence: number,
  ): Promise<boolean>;
  hasUserFindingUsingAnyOrigin(
    userId: string,
    sourceEventIds: number[],
  ): Promise<boolean>;
  hasAgentContributedToRequestThread(
    agentId: string,
    replyToSequence: number,
    excludedWakeId?: string,
  ): Promise<boolean>;
  appendCommunicationEvent(
    input: AppendCommunicationEventInput,
  ): Promise<DiscoveryEvent>;
}
