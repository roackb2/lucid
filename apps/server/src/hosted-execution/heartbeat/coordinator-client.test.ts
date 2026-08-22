import { describe, expect, it, vi } from 'vitest';
import { HostedHeartbeatCoordinatorClient } from './coordinator-client.js';
import { HostedHeartbeatCoordinatorApiCredentials } from './coordinator-credentials.js';

describe('HostedHeartbeatCoordinatorClient', () => {
  it('uses the scoped bearer and returns Heddle task identity and workspace', async () => {
    const environment = {
      COORDINATOR_TOKEN: 'coordinator-api-token-'.padEnd(32, 'x'),
    };
    const credentials = HostedHeartbeatCoordinatorApiCredentials.takeOptional(
      environment,
      'COORDINATOR_TOKEN',
    );
    if (!credentials) {
      throw new Error('Expected coordinator credentials.');
    }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(
      JSON.stringify({
        tasks: [{
          id: 'lucid-representative-agent-a',
          workspaceId: 'workspace-v1',
        }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = new HostedHeartbeatCoordinatorClient(
      new URL('http://127.0.0.1:18082'),
      credentials,
      fetch,
    );

    await expect(client.listTasks()).resolves.toEqual([
      {
        id: 'lucid-representative-agent-a',
        workspaceId: 'workspace-v1',
      },
    ]);
    expect(environment.COORDINATOR_TOKEN).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:18082/v1/heartbeat/tasks'),
      expect.objectContaining({
        method: 'GET',
        headers: {
          authorization: expect.stringMatching(/^Bearer /),
        },
      }),
    );
  });
});
