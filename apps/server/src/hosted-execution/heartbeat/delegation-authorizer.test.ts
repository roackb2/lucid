import { describe, expect, it } from 'vitest';
import type {
  Agent,
  DiscoveryWorkspace,
  User,
} from '../../lucid/discovery-types.js';
import { taskIdForAgent } from '../../lucid/agent/heartbeat-task-identity.js';
import { LucidHeartbeatDelegationAuthorizer } from './delegation-authorizer.js';

describe('LucidHeartbeatDelegationAuthorizer', () => {
  it('returns current Lucid identity and MCP policy for an active owner', async () => {
    const authorizer = new LucidHeartbeatDelegationAuthorizer(
      storeFixture(true),
      {
        tenantId: 'tenant-1',
        productSessionId: 'workspace-1',
        allowedTools: ['read_workspace_snapshot'],
      },
    );

    await expect(authorizer.authorize({
      taskId: taskIdForAgent('agent-1'),
      executionId: 'execution-1',
      signal: new AbortController().signal,
    })).resolves.toEqual({
      scope: {
        tenantId: 'tenant-1',
        subjectId: 'user-1',
        productSessionId: 'workspace-1',
      },
      allowedTools: ['read_workspace_snapshot'],
    });
  });

  it('rejects work while Lucid background checks are paused', async () => {
    const authorizer = new LucidHeartbeatDelegationAuthorizer(
      storeFixture(false),
      {
        tenantId: 'tenant-1',
        productSessionId: 'workspace-1',
        allowedTools: [],
      },
    );

    await expect(authorizer.authorize({
      taskId: taskIdForAgent('agent-1'),
      executionId: 'execution-1',
      signal: new AbortController().signal,
    })).resolves.toBeUndefined();
  });
});

function storeFixture(backgroundChecksEnabled: boolean) {
  const workspace: DiscoveryWorkspace = {
    id: 'workspace-1',
    versionId: 'version-1',
    currentWake: 0,
    backgroundChecksEnabled,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
  const user: User = {
    id: 'user-1',
    workspaceId: workspace.id,
    kind: 'human',
    status: 'active',
    displayName: 'User',
    privateContext: '',
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
  const agent: Agent = {
    id: 'agent-1',
    workspaceId: workspace.id,
    userId: user.id,
    sortOrder: 0,
    name: 'Agent',
    role: 'representative',
    color: 'green',
    purpose: 'Represent the user',
    instructions: '',
    status: 'idle',
    runCount: 0,
    mailboxFloorSequence: 0,
    lastSeenSequence: 0,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
  return {
    readWorkspace: async () => workspace,
    listAgents: async () => [agent],
    listUsers: async () => [user],
  };
}
