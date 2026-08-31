/** Persistence port for agent wake orchestration. */
import type {
  Agent,
  AgentWakeClaim,
  AppendDiscoveryEventInput,
  DiscoveryEvent,
  DiscoveryWorkspace,
  User,
} from '../discovery-types.js';

export type RecordWakeCompletionInput = Omit<
  AppendDiscoveryEventInput,
  'kind'
>;

export type PrepareBackgroundChecksResumeInput = {
  admissionGroupId: string;
  transitionId: string;
};

export type BackgroundChecksResumePreparation =
  | {
      status: 'prepared';
      admissionGroupId: string;
      transitionId: string;
      mailboxFloorSequence: number;
      agentCount: number;
      preparedAt: string;
    }
  | {
      status: 'waiting';
      reason: 'background-checks-disabled' | 'agent-wake-running';
      runningAgentIds: string[];
    };

export interface AgentWakeStore {
  reset(options: { backgroundChecksEnabled: boolean }): Promise<void>;
  readWorkspace(): Promise<DiscoveryWorkspace>;
  setBackgroundChecksEnabled(enabled: boolean): Promise<DiscoveryWorkspace>;
  prepareBackgroundChecksResume(
    input: PrepareBackgroundChecksResumeInput,
  ): Promise<BackgroundChecksResumePreparation>;
  listUsers(): Promise<User[]>;
  listAgents(): Promise<Agent[]>;
  listActiveAgents(): Promise<Agent[]>;
  readEvent(sequence: number): Promise<DiscoveryEvent | undefined>;
  listAgentWakeCommunicationEvents(
    agentId: string,
    wakeNumber: number,
  ): Promise<DiscoveryEvent[]>;
  beginAgentWake(
    agentId: string,
    wakeId: string,
  ): Promise<AgentWakeClaim | undefined>;
  readClaimedAgentWake(
    agentId: string,
    claimToken: string,
  ): Promise<AgentWakeClaim | undefined>;
  completeAgentWake(
    agentId: string,
    claimToken: string,
    horizonSequence: number,
  ): Promise<void>;
  failAgentWake(agentId: string, claimToken: string): Promise<void>;
  interruptAgentWake(agentId: string, claimToken: string): Promise<void>;
  recoverInterruptedAgentWake(
    agentId: string,
    interruptedExecutionId: string,
  ): Promise<boolean>;
  findAgentPublishedRequestForTrigger(
    agentId: string,
    triggerSequence: number,
  ): Promise<DiscoveryEvent | undefined>;
  hasAgentUpdatedWorkingNoteThrough(
    agentId: string,
    sourceSequence: number,
  ): Promise<boolean>;
  recordWakeCompletion(
    input: RecordWakeCompletionInput,
  ): Promise<DiscoveryEvent>;
}
