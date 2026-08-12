import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import sirv from 'sirv';

const ASSET_CACHE_CONTROL = 'public,max-age=31536000,immutable';
const HTML_CACHE_CONTROL = 'no-cache';

export type StaticSpaRequestHandler = {
  tryServe: (request: IncomingMessage, response: ServerResponse) => boolean;
};

/**
 * Adapts sirv to Lucid's raw HTTP composition root. Sirv owns static file
 * delivery; this handler owns SPA navigation fallback and browser cache policy.
 * API and health routing remain outside this boundary.
 */
export async function createStaticSpaRequestHandler(
  configuredRoot: string,
): Promise<StaticSpaRequestHandler> {
  const root = resolve(configuredRoot);
  const indexPath = join(root, 'index.html');
  const indexStats = await stat(indexPath).catch(() => undefined);

  if (!indexStats?.isFile()) {
    throw new Error(`Lucid web root is missing index.html: ${root}`);
  }

  const options = {
    dotfiles: false,
    etag: true,
    setHeaders: setStaticSpaResponseHeaders,
  } as const;
  const serveStaticAsset = sirv(root, options);
  const serveSpaNavigation = sirv(root, {
    ...options,
    single: 'index.html',
  });

  return Object.freeze({
    tryServe(request: IncomingMessage, response: ServerResponse) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return false;
      }

      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const serve = extname(pathname)
        ? serveStaticAsset
        : serveSpaNavigation;
      serve(request, response, () => writeStaticAssetNotFound(response));
      return true;
    },
  });
}

function setStaticSpaResponseHeaders(
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

function writeStaticAssetNotFound(response: ServerResponse): void {
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
