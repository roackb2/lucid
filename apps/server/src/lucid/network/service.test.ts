import { describe, expect, it, vi } from 'vitest';
import type {
  AgentHeartbeatControl,
} from '../agent/heartbeat-control.js';
import type {
  AgentTaskView,
  AgentView,
  BackgroundChecksView,
  DiscoveryWorkspace,
  UserView,
} from '../discovery-types.js';
import { UserNetworkService } from './service.js';
import type {
  NetworkDiagnosticsStoreSnapshot,
  UserNetworkStore,
  UserWithAgent,
} from './store.js';

describe('user network identity enrollment', () => {
  it('reconciles the new agent and returns product identifiers', async () => {
    const enrolled = userWithAgent();
    const enrollAuthenticatedUser = vi.fn(async () => enrolled);
    const reconcileAgentTasks = vi.fn(async () => undefined);
    const service = new UserNetworkService(
      { enrollAuthenticatedUser } as unknown as UserNetworkStore,
      { reconcileAgentTasks } as unknown as AgentHeartbeatControl,
      { model: 'test-model', heddleVersion: 'test-version' },
    );

    await expect(service.enrollAuthenticatedUser({
      issuer: 'https://identity.example.test',
      subject: 'verified-subject',
      displayName: 'Avery',
      privateContext: 'One approved private goal.',
      contextApproved: true,
    })).resolves.toEqual({
      created: true,
      userId: enrolled.user.id,
      agentId: enrolled.agent.id,
      displayName: 'Avery',
      kind: 'human',
    });
    expect(enrollAuthenticatedUser).toHaveBeenCalledOnce();
    expect(reconcileAgentTasks).toHaveBeenCalledOnce();
  });
});

describe('synthetic peer Agent task administration', () => {
  it('pauses only active synthetic peer tasks without changing users', async () => {
    const network = peerNetwork();
    const disableAgentTasks = vi.fn(async () => undefined);
    const setUserStatus = vi.fn();
    const service = new UserNetworkService(
      {
        readNetworkDiagnostics: vi.fn(async () => network),
        setUserStatus,
      } as unknown as UserNetworkStore,
      {
        snapshot: vi.fn(async () => peerBackgroundChecks()),
        disableAgentTasks,
      } as unknown as AgentHeartbeatControl,
      { model: 'test-model', heddleVersion: 'test-version' },
    );

    await service.setSyntheticPeerAgentTasksEnabled(false, 2);

    expect(disableAgentTasks).toHaveBeenCalledWith([
      'agent-builder',
      'agent-organizer',
    ]);
    expect(setUserStatus).not.toHaveBeenCalled();
  });

  it('fails closed when the expected peer count does not match', async () => {
    const disableAgentTasks = vi.fn(async () => undefined);
    const service = new UserNetworkService(
      {
        readNetworkDiagnostics: vi.fn(async () => peerNetwork()),
      } as unknown as UserNetworkStore,
      {
        snapshot: vi.fn(async () => peerBackgroundChecks()),
        disableAgentTasks,
      } as unknown as AgentHeartbeatControl,
      { model: 'test-model', heddleVersion: 'test-version' },
    );

    await expect(service.setSyntheticPeerAgentTasksEnabled(false, 4))
      .rejects.toThrow('Expected 4 active synthetic peer Agents, found 2.');
    expect(disableAgentTasks).not.toHaveBeenCalled();
  });

  it('rolls back tasks enabled earlier in a failed resume', async () => {
    const enableAgentTask = vi.fn(async (agentId: string) => {
      if (agentId === 'agent-organizer') {
        throw new Error('resume failed');
      }
    });
    const disableAgentTasks = vi.fn(async () => undefined);
    const service = new UserNetworkService(
      {
        readNetworkDiagnostics: vi.fn(async () => peerNetwork()),
      } as unknown as UserNetworkStore,
      {
        snapshot: vi.fn(async () => peerBackgroundChecks({ enabled: false })),
        enableAgentTask,
        disableAgentTasks,
      } as unknown as AgentHeartbeatControl,
      { model: 'test-model', heddleVersion: 'test-version' },
    );

    await expect(service.setSyntheticPeerAgentTasksEnabled(true, 2))
      .rejects.toThrow('resume failed');
    expect(enableAgentTask).toHaveBeenNthCalledWith(1, 'agent-builder');
    expect(enableAgentTask).toHaveBeenNthCalledWith(2, 'agent-organizer');
    expect(disableAgentTasks).toHaveBeenCalledWith(['agent-builder']);
  });
});

function userWithAgent(): UserWithAgent {
  const now = '2026-08-13T00:00:00.000Z';
  return {
    created: true,
    user: {
      id: 'user_avery',
      workspaceId: 'lucid-workspace',
      kind: 'human',
      status: 'active',
      displayName: 'Avery',
      privateContext: 'One approved private goal.',
      contextConsentAt: now,
      createdAt: now,
      updatedAt: now,
    },
    agent: {
      id: 'agent_avery',
      workspaceId: 'lucid-workspace',
      userId: 'user_avery',
      sortOrder: 2,
      name: 'Avery agent',
      role: 'Personal agent',
      color: '#ffffff',
      purpose: 'Represent Avery in the network.',
      instructions: 'Act for Avery.',
      status: 'idle',
      runCount: 0,
      mailboxFloorSequence: 0,
      lastSeenSequence: 0,
      createdAt: now,
      updatedAt: now,
    },
  };
}

const WORKSPACE = {
  id: 'lucid-workspace',
  versionId: 'version-1',
  currentWake: 0,
  backgroundChecksEnabled: false,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
} satisfies DiscoveryWorkspace;

function peerNetwork(): NetworkDiagnosticsStoreSnapshot {
  const builder = userView('user-builder', 'synthetic', 'active', 'Builder');
  const organizer = userView(
    'user-organizer',
    'synthetic',
    'active',
    'Organizer',
  );
  const disabled = userView(
    'user-disabled',
    'synthetic',
    'disabled',
    'Disabled peer',
  );
  const human = userView('user-human', 'human', 'active', 'Human peer');
  const users = [builder, organizer, disabled, human];
  return {
    workspace: WORKSPACE,
    users,
    agents: users.map((user, index) => agentView(user, index)),
    events: [],
  };
}

function peerBackgroundChecks(
  options: { enabled?: boolean } = {},
): BackgroundChecksView {
  const task = (agentId: string): AgentTaskView => ({
    taskId: `lucid-agent:${agentId}`,
    agentId,
    enabled: options.enabled ?? true,
    status: 'waiting',
    progress: 'Waiting.',
    intervalMs: 900_000,
  });
  return {
    enabled: options.enabled ?? true,
    dispatchEnabled: false,
    running: false,
    intervalMs: 900_000,
    tasks: [
      task('agent-builder'),
      task('agent-organizer'),
      task('agent-disabled'),
      task('agent-human'),
    ],
  };
}

function userView(
  id: string,
  kind: UserView['kind'],
  status: UserView['status'],
  displayName: string,
): UserView {
  return {
    id,
    workspaceId: WORKSPACE.id,
    kind,
    status,
    displayName,
    createdAt: WORKSPACE.createdAt,
    updatedAt: WORKSPACE.updatedAt,
  };
}

function agentView(user: UserView, sortOrder: number): AgentView {
  return {
    id: user.id.replace('user-', 'agent-'),
    workspaceId: WORKSPACE.id,
    userId: user.id,
    sortOrder,
    name: `${user.displayName} Agent`,
    role: 'Personal agent',
    color: '#ffffff',
    purpose: `Represent ${user.displayName}.`,
    status: 'idle',
    runCount: 0,
    createdAt: WORKSPACE.createdAt,
    updatedAt: WORKSPACE.updatedAt,
    user,
    unreadCount: 0,
    isCurrentUserAgent: false,
  };
}
