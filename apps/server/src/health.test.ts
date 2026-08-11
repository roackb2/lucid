import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { handleHealthRequest } from './health.js';

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

describe('health HTTP handler', () => {
  it('serves a non-cacheable process-liveness response', async () => {
    const origin = await listen();

    const response = await fetch(new URL('/healthz', origin));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('leaves unrelated routes to the application router', async () => {
    const origin = await listen();

    const response = await fetch(new URL('/other', origin));

    expect(response.status).toBe(404);
  });
});

async function listen(): Promise<URL> {
  const server = createServer((request, response) => {
    if (handleHealthRequest(request, response)) {
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}`);
}
