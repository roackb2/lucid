/** Persistence port for trusted participant-network administration. */
import type {
  Agent,
  AgentView,
  DiscoveryEvent,
  DiscoveryWorkspace,
  Participant,
  ParticipantStatus,
  ParticipantView,
  RegisterParticipantInput,
} from '../discovery-types.js';

export type NetworkDiagnosticsStoreSnapshot = {
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

export interface ParticipantNetworkStore {
  readNetworkDiagnostics(): Promise<NetworkDiagnosticsStoreSnapshot>;
  requireAgentByParticipantId(participantId: string): Promise<Agent>;
  registerParticipant(
    input: RegisterParticipantInput,
  ): Promise<ParticipantWithAgent>;
  setParticipantStatus(
    participantId: string,
    status: Extract<ParticipantStatus, 'active' | 'disabled'>,
  ): Promise<ParticipantWithAgent>;
  retireParticipant(participantId: string): Promise<ParticipantWithAgent>;
  saveParticipantInput(
    participantId: string,
    content: string,
    idempotencyKey: string,
  ): Promise<DiscoveryEvent>;
}
