import type { IncomingMessage, ServerResponse } from 'node:http';

export const LUCID_HEALTH_PATH = '/healthz';

/**
 * Exposes process liveness without authenticating a participant or implying
 * that PostgreSQL and external execution dependencies are ready.
 */
export function handleHealthRequest(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (
    request.method !== 'GET'
    || new URL(request.url ?? '/', 'http://localhost').pathname
      !== LUCID_HEALTH_PATH
  ) {
    return false;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify({ status: 'ok' }));
  return true;
}
