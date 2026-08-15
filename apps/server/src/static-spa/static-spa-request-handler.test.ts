import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createStaticSpaRequestHandler,
} from './static-spa-request-handler.js';

const roots = new Set<string>();
const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
  servers.clear();
  await Promise.all([...roots].map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
  roots.clear();
});

describe('static SPA request handler', () => {
  it('serves HTML navigation and immutable built assets', async () => {
    const root = await createFixture();
    const origin = await listen(root);

    const rootResponse = await fetch(new URL('/', origin));
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get('cache-control')).toBe('no-cache');
    await expect(rootResponse.text()).resolves.toContain('Lucid test shell');

    const navigationResponse = await fetch(new URL('/findings/latest', origin));
    expect(navigationResponse.status).toBe(200);
    expect(navigationResponse.headers.get('content-type')).toContain('text/html');

    const assetResponse = await fetch(new URL('/assets/app-abcd1234.js', origin));
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get('cache-control')).toBe(
      'public,max-age=31536000,immutable',
    );
    await expect(assetResponse.text()).resolves.toBe('export const ready = true;');
  });

  it('returns a bounded 404 for missing files instead of serving HTML', async () => {
    const origin = await listen(await createFixture());

    const response = await fetch(new URL('/assets/missing.js', origin));

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('Not found.');
  });

  it('leaves non-read methods to the application transport', async () => {
    const origin = await listen(await createFixture());

    const response = await fetch(new URL('/', origin), { method: 'POST' });

    expect(response.status).toBe(405);
  });

  it('fails startup when the configured build is incomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lucid-static-spa-empty-'));
    roots.add(root);

    await expect(createStaticSpaRequestHandler(root)).rejects.toThrow(
      'Lucid SPA root is missing index.html',
    );
  });
});

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lucid-static-spa-'));
  roots.add(root);
  await mkdir(join(root, 'assets'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><body>Lucid test shell</body></html>',
  );
  await writeFile(
    join(root, 'assets', 'app-abcd1234.js'),
    'export const ready = true;',
  );
  return root;
}

async function listen(root: string): Promise<URL> {
  const staticSpaRequestHandler = await createStaticSpaRequestHandler(root);
  const server = createServer((request, response) => {
    if (staticSpaRequestHandler.tryServe(request, response)) {
      return;
    }
    response.statusCode = 405;
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
