/** Persistence port exposed to one representative's communication tools. */
import type {
  Agent,
  AppendDiscoveryEventInput,
  DiscoveryEvent,
} from '../../discovery-types.js';

export interface AgentCommunicationRepository {
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
  hasParticipantFindingUsingAnyOrigin(
    participantId: string,
    sourceEventIds: number[],
  ): Promise<boolean>;
  hasAgentContributedToRequestThread(
    agentId: string,
    replyToSequence: number,
    currentWakeId: string,
  ): Promise<boolean>;
  appendEvent(input: AppendDiscoveryEventInput): Promise<DiscoveryEvent>;
}
