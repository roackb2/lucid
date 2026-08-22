import { HEARTBEAT_TASK_WORKFLOW } from '@heddleagent/execution-host-client/contracts';
import type {
  ExecutionAuthorityIssueInput,
  IssuedExecutionAuthority,
  IssuedExecutionAuthorityMetadata,
} from '@heddleagent/execution-host-client/authority';
import { describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  DiscoveryWorkspace,
  User,
} from '../../lucid/discovery-types.js';
import { taskIdForAgent } from '../../lucid/agent/heartbeat-task-identity.js';
import {
  HostedHeartbeatDelegationRejectedError,
  HostedHeartbeatDelegationService,
} from './delegation-service.js';

describe('HostedHeartbeatDelegationService', () => {
  it('issues one heartbeat authority for the task current active owner', async () => {
    const issue = vi.fn(async (
      input: ExecutionAuthorityIssueInput,
    ): Promise<IssuedExecutionAuthority> => {
      const metadata: IssuedExecutionAuthorityMetadata = {
        ...input,
        scope: { adopterId: 'lucid', ...input.scope },
        issuedAt: '2026-08-19T00:00:00.000Z',
        executionExpiresAt: '2026-08-19T00:01:00.000Z',
        mcp: {
          capabilityId: 'capability-1',
          serverId: 'lucid_product',
          allowedTools: input.mcp?.allowedTools ?? [],
          expiresAt: '2026-08-19T00:01:00.000Z',
        },
      };
      return {
        metadata,
        executionAssertion: () => 'execution-assertion',
        mcpCapability: () => 'mcp-capability',
        toJSON: () => metadata,
      };
    });
    const service = new HostedHeartbeatDelegationService(
      { issue },
      storeFixture(true),
      {
        tenantId: 'tenant-1',
        productSessionId: 'workspace-1',
        maxTurnMs: 60_000,
        allowedTools: ['read_workspace_snapshot'],
      },
      { now: () => new Date('2026-08-19T00:00:00.000Z') },
    );

    const result = await service.issue({
      schemaVersion: 1,
      taskId: taskIdForAgent('agent-1'),
      executionId: 'execution-1',
    });

    expect(issue).toHaveBeenCalledWith(expect.objectContaining({
      invocationId: 'execution-1',
      workflow: HEARTBEAT_TASK_WORKFLOW,
      scope: {
        tenantId: 'tenant-1',
        subjectId: 'user-1',
        productSessionId: 'workspace-1',
      },
    }));
    expect(result).toMatchObject({
      taskId: taskIdForAgent('agent-1'),
      executionId: 'execution-1',
      deadlineAt: '2026-08-19T00:01:00.000Z',
      authority: {
        executionAssertion: 'execution-assertion',
        mcpCapability: 'mcp-capability',
      },
    });
  });

  it('rejects work while Lucid background checks are paused', async () => {
    const service = new HostedHeartbeatDelegationService(
      { issue: vi.fn() },
      storeFixture(false),
      {
        tenantId: 'tenant-1',
        productSessionId: 'workspace-1',
        maxTurnMs: 60_000,
        allowedTools: [],
      },
    );

    await expect(service.issue({
      schemaVersion: 1,
      taskId: taskIdForAgent('agent-1'),
      executionId: 'execution-1',
    })).rejects.toBeInstanceOf(HostedHeartbeatDelegationRejectedError);
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
