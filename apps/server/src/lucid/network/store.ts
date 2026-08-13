/** Persistence port for trusted user-network administration. */
import type {
  Agent,
  AgentView,
  DiscoveryEvent,
  DiscoveryWorkspace,
  User,
  UserStatus,
  UserView,
  RegisterUserInput,
} from '../discovery-types.js';

export type NetworkDiagnosticsStoreSnapshot = {
  workspace: DiscoveryWorkspace;
  users: UserView[];
  agents: AgentView[];
  events: DiscoveryEvent[];
};

export type UserWithAgent = {
  user: User;
  agent: Agent;
  created?: boolean;
};

/** Case-sensitive subject identity from a successfully verified provider token. */
export type AuthenticatedUserIdentity = {
  issuer: string;
  subject: string;
};

/** First-time product profile attached to an authenticated human principal. */
export type EnrollAuthenticatedUserInput =
  AuthenticatedUserIdentity & {
    displayName: string;
    privateContext: string;
    contextApproved: boolean;
  };

/** Product identity resolved without exposing provider claims downstream. */
export type ResolvedUserIdentity = {
  userId: string;
  status: UserStatus;
};

export interface UserIdentityReader {
  resolveUserIdentity(
    identity: AuthenticatedUserIdentity,
  ): Promise<ResolvedUserIdentity | undefined>;
}

export interface UserNetworkStore extends UserIdentityReader {
  enrollAuthenticatedUser(
    input: EnrollAuthenticatedUserInput,
  ): Promise<UserWithAgent>;
  readNetworkDiagnostics(): Promise<NetworkDiagnosticsStoreSnapshot>;
  requireAgentByUserId(userId: string): Promise<Agent>;
  registerUser(
    input: RegisterUserInput,
  ): Promise<UserWithAgent>;
  setUserStatus(
    userId: string,
    status: Extract<UserStatus, 'active' | 'disabled'>,
  ): Promise<UserWithAgent>;
  retireUser(userId: string): Promise<UserWithAgent>;
  saveUserInput(
    userId: string,
    content: string,
    idempotencyKey: string,
  ): Promise<DiscoveryEvent>;
}
