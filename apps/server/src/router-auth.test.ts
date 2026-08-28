import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryWorkspaceService } from './lucid/workspace/service.js';
import type { UserNetworkService } from './lucid/network/service.js';
import { createAppRouter } from './router.js';
import type { LucidRequestContext } from './trpc.js';

describe('Lucid router authorization', () => {
  it('rejects anonymous and user principals without a durable binding', async () => {
    const { caller, snapshot } = createCaller({
      requestId: 'anonymous',
      remoteAddress: '127.0.0.1',
    });
    await expect(caller.discovery.snapshot()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    const unbound = createCaller({
      requestId: 'forged',
      remoteAddress: '127.0.0.1',
      principal: {
        subject: 'user:someone-else',
        roles: ['user'],
      },
    });
    await expect(unbound.caller.discovery.snapshot()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(snapshot).not.toHaveBeenCalled();
    expect(unbound.snapshot).not.toHaveBeenCalled();
  });

  it('passes only the server-derived user into discovery', async () => {
    const { caller, snapshot } = createCaller({
      requestId: 'user',
      remoteAddress: '203.0.113.10',
      principal: {
        subject: 'user:local-user',
        userId: 'local-user',
        roles: ['user'],
      },
    });

    await expect(caller.discovery.snapshot()).resolves.toEqual({ ok: true });
    expect(snapshot).toHaveBeenCalledWith('local-user');
  });

  it('lists hosted conversation history only for the server-derived user', async () => {
    const anonymous = createCaller({
      requestId: 'anonymous-history',
      remoteAddress: '127.0.0.1',
    });
    await expect(anonymous.caller.hostedConversation.recent())
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const unbound = createCaller({
      requestId: 'unbound-history',
      remoteAddress: '127.0.0.1',
      principal: {
        subject: 'provider-subject-without-product-user',
        roles: ['user'],
      },
    });
    await expect(unbound.caller.hostedConversation.recent())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(unbound.recentConversations).not.toHaveBeenCalled();

    const user = createCaller({
      requestId: 'user-history',
      remoteAddress: '203.0.113.10',
      principal: {
        subject: 'replaceable-provider-subject',
        userId: 'local-user',
        roles: ['user'],
      },
    });
    await expect(user.caller.hostedConversation.recent())
      .resolves.toEqual([]);
    expect(user.recentConversations).toHaveBeenCalledWith('local-user');
  });

  it('lets a verified unbound identity enroll only when deployment permits it', async () => {
    const context: LucidRequestContext = {
      requestId: 'new-google-user',
      remoteAddress: '203.0.113.10',
      principal: {
        subject: 'https://project.supabase.co/auth/v1:subject-a',
        externalIdentity: {
          issuer: 'https://project.supabase.co/auth/v1',
          subject: 'subject-a',
        },
        roles: [],
      },
    };
    const disabled = createCaller(context);
    await expect(disabled.caller.identity.session()).resolves.toMatchObject({
      status: 'onboarding-required',
      enrollmentAllowed: false,
    });
    await expect(disabled.caller.identity.enroll({
      displayName: 'Avery',
      privateContext: 'Find useful information about durable agent systems.',
      contextApproved: true,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const enabled = createCaller(context, { allowSelfEnrollment: true });
    await expect(enabled.caller.identity.enroll({
      displayName: 'Avery',
      privateContext: 'Find useful information about durable agent systems.',
      contextApproved: true,
    })).resolves.toEqual({ userId: 'user_avery' });
    expect(enabled.enrollAuthenticatedUser).toHaveBeenCalledWith({
      issuer: 'https://project.supabase.co/auth/v1',
      subject: 'subject-a',
      displayName: 'Avery',
      privateContext: 'Find useful information about durable agent systems.',
      contextApproved: true,
    });
  });

  it('requires both operator role and loopback for development routes', async () => {
    const user = createCaller({
      requestId: 'user-only',
      remoteAddress: '127.0.0.1',
      principal: {
        subject: 'user:local-user',
        userId: 'local-user',
        roles: ['user'],
      },
    });
    await expect(user.caller.development.diagnostics())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    const remoteOperator = createCaller({
      requestId: 'remote-operator',
      remoteAddress: '203.0.113.10',
      principal: {
        subject: 'operator:owner',
        roles: ['operator'],
      },
    });
    await expect(remoteOperator.caller.development.diagnostics())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(remoteOperator.caller.development
      .setSyntheticPeerAgentTasksEnabled({
        enabled: false,
        expectedCount: 4,
      }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    const localOperator = createCaller({
      requestId: 'local-operator',
      remoteAddress: '::1',
      principal: {
        subject: 'operator:owner',
        roles: ['operator'],
      },
    });
    await expect(localOperator.caller.development.diagnostics())
      .resolves.toEqual({ ok: true });
    await expect(localOperator.caller.development
      .setSyntheticPeerAgentTasksEnabled({
        enabled: false,
        expectedCount: 4,
      }))
      .resolves.toEqual({ ok: true });
    expect(localOperator.diagnostics).toHaveBeenCalledOnce();
    expect(localOperator.setSyntheticPeerAgentTasksEnabled)
      .toHaveBeenCalledWith(false, 4);
  });

  it('allows only an authenticated operator to control the global dispatch gate', async () => {
    const user = createCaller({
      requestId: 'user-only',
      remoteAddress: '203.0.113.10',
      principal: {
        subject: 'user:local-user',
        userId: 'local-user',
        roles: ['user'],
      },
    });
    await expect(user.caller.operator.backgroundChecks())
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    const remoteOperator = createCaller({
      requestId: 'remote-operator',
      remoteAddress: '203.0.113.10',
      principal: {
        subject: 'operator:owner',
        roles: ['operator'],
      },
    });
    await expect(remoteOperator.caller.operator.backgroundChecks())
      .resolves.toEqual({ enabled: true });
    await expect(remoteOperator.caller.operator.setGlobalBackgroundChecksEnabled({
      enabled: false,
    })).resolves.toEqual({ enabled: false });
    expect(remoteOperator.backgroundChecks).toHaveBeenCalledOnce();
    expect(remoteOperator.setGlobalBackgroundChecksEnabled)
      .toHaveBeenCalledWith(false);
  });
});

function createCaller(
  context: LucidRequestContext,
  options: { allowSelfEnrollment?: boolean } = {},
) {
  const snapshot = vi.fn(async () => ({ ok: true }));
  const diagnostics = vi.fn(async () => ({ ok: true }));
  const backgroundChecks = vi.fn(async () => ({ enabled: true }));
  const setGlobalBackgroundChecksEnabled = vi.fn(async (enabled: boolean) => ({
    enabled,
  }));
  const setSyntheticPeerAgentTasksEnabled = vi.fn(async () => ({ ok: true }));
  const enrollAuthenticatedUser = vi.fn(async () => ({
    userId: 'user_avery',
  }));
  const recentConversations = vi.fn(async () => []);
  const discoveryWorkspace = {
    snapshot,
  } as unknown as DiscoveryWorkspaceService;
  const userNetwork = {
    diagnostics,
    backgroundChecks,
    setGlobalBackgroundChecksEnabled,
    setSyntheticPeerAgentTasksEnabled,
    enrollAuthenticatedUser,
  } as unknown as UserNetworkService;
  const caller = createAppRouter(
    discoveryWorkspace,
    userNetwork,
    { recentForUser: recentConversations },
    options,
  ).createCaller(context);
  return {
    caller,
    diagnostics,
    snapshot,
    backgroundChecks,
    setGlobalBackgroundChecksEnabled,
    setSyntheticPeerAgentTasksEnabled,
    enrollAuthenticatedUser,
    recentConversations,
  };
}
