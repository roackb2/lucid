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

/** Case-sensitive subject identity from a successfully verified provider token. */
export type AuthenticatedParticipantIdentity = {
  issuer: string;
  subject: string;
};

/** First-time product profile attached to an authenticated human principal. */
export type EnrollAuthenticatedParticipantInput =
  AuthenticatedParticipantIdentity & {
    displayName: string;
    privateContext: string;
    contextApproved: boolean;
  };

/** Product identity resolved without exposing provider claims downstream. */
export type ResolvedParticipantIdentity = {
  participantId: string;
  status: ParticipantStatus;
};

export interface ParticipantIdentityReader {
  resolveParticipantIdentity(
    identity: AuthenticatedParticipantIdentity,
  ): Promise<ResolvedParticipantIdentity | undefined>;
}

export interface ParticipantNetworkStore extends ParticipantIdentityReader {
  enrollAuthenticatedParticipant(
    input: EnrollAuthenticatedParticipantInput,
  ): Promise<ParticipantWithAgent>;
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
