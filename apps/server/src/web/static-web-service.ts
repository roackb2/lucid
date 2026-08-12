import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import sirv from 'sirv';

const ASSET_CACHE_CONTROL = 'public,max-age=31536000,immutable';
const HTML_CACHE_CONTROL = 'no-cache';

export type StaticWebService = {
  handle: (request: IncomingMessage, response: ServerResponse) => boolean;
};

/**
 * Serves one pre-built SPA from an explicitly configured directory. API and
 * health routing stay in the composition root; this boundary owns only files,
 * SPA navigation fallback, and browser cache policy.
 */
export async function createStaticWebService(
  configuredRoot: string,
): Promise<StaticWebService> {
  const root = resolve(configuredRoot);
  const indexPath = join(root, 'index.html');
  const indexStats = await stat(indexPath).catch(() => undefined);

  if (!indexStats?.isFile()) {
    throw new Error(`Lucid web root is missing index.html: ${root}`);
  }

  const options = {
    dotfiles: false,
    etag: true,
    setHeaders: setStaticHeaders,
  } as const;
  const serveAsset = sirv(root, options);
  const serveNavigation = sirv(root, {
    ...options,
    single: 'index.html',
  });

  return Object.freeze({
    handle(request: IncomingMessage, response: ServerResponse) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return false;
      }

      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const handler = extname(pathname) ? serveAsset : serveNavigation;
      handler(request, response, () => writeNotFound(response));
      return true;
    },
  });
}

function setStaticHeaders(
  response: ServerResponse,
  pathname: string,
): void {
  response.setHeader(
    'Cache-Control',
    pathname.startsWith('/assets/')
      ? ASSET_CACHE_CONTROL
      : HTML_CACHE_CONTROL,
  );
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function writeNotFound(response: ServerResponse): void {
  if (response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(404, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end('Not found.');
}
