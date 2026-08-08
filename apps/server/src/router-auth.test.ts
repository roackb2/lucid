import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryWorkspaceService } from './lucid/discovery-workspace-service.js';
import type { ParticipantNetworkService } from './lucid/participant-network-service.js';
import { createAppRouter } from './router.js';
import type { LucidRequestContext } from './trpc.js';

describe('Lucid router authorization', () => {
  it('rejects anonymous and forged discovery principals', async () => {
    const { caller, snapshot } = createCaller({
      requestId: 'anonymous',
      remoteAddress: '127.0.0.1',
    });
    await expect(caller.discovery.snapshot()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    const forged = createCaller({
      requestId: 'forged',
      remoteAddress: '127.0.0.1',
      principal: {
        subject: 'participant:someone-else',
        participantId: 'someone-else',
        roles: ['participant'],
      },
    });
    await expect(forged.caller.discovery.snapshot()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(snapshot).not.toHaveBeenCalled();
    expect(forged.snapshot).not.toHaveBeenCalled();
  });

  it('allows only the server-derived local participant into discovery', async () => {
    const { caller, snapshot } = createCaller({
      requestId: 'participant',
      remoteAddress: '203.0.113.10',
      principal: {
        subject: 'participant:local-user',
        participantId: 'local-user',
        roles: ['participant'],
      },
    });

    await expect(caller.discovery.snapshot()).resolves.toEqual({ ok: true });
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it('requires both operator role and loopback for development routes', async () => {
    const participant = createCaller({
      requestId: 'participant-only',
      remoteAddress: '127.0.0.1',
      principal: {
        subject: 'participant:local-user',
        participantId: 'local-user',
        roles: ['participant'],
      },
    });
    await expect(participant.caller.development.diagnostics())
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
    expect(localOperator.diagnostics).toHaveBeenCalledOnce();
  });

  it('allows only an authenticated operator to control the global dispatch gate', async () => {
    const participant = createCaller({
      requestId: 'participant-only',
      remoteAddress: '203.0.113.10',
      principal: {
        subject: 'participant:local-user',
        participantId: 'local-user',
        roles: ['participant'],
      },
    });
    await expect(participant.caller.operator.backgroundChecks())
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

function createCaller(context: LucidRequestContext) {
  const snapshot = vi.fn(async () => ({ ok: true }));
  const diagnostics = vi.fn(async () => ({ ok: true }));
  const backgroundChecks = vi.fn(async () => ({ enabled: true }));
  const setGlobalBackgroundChecksEnabled = vi.fn(async (enabled: boolean) => ({
    enabled,
  }));
  const discoveryWorkspace = {
    snapshot,
  } as unknown as DiscoveryWorkspaceService;
  const participantNetwork = {
    diagnostics,
    backgroundChecks,
    setGlobalBackgroundChecksEnabled,
  } as unknown as ParticipantNetworkService;
  const caller = createAppRouter(
    discoveryWorkspace,
    participantNetwork,
  ).createCaller(context);
  return {
    caller,
    diagnostics,
    snapshot,
    backgroundChecks,
    setGlobalBackgroundChecksEnabled,
  };
}
