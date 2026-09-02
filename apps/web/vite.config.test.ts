import { describe, expect, it } from 'vitest';
import { resolveAllowedHosts } from './vite.config';

describe('Vite trusted proxy hosts', () => {
  it('accepts trimmed, comma-separated exact hostnames', () => {
    expect(resolveAllowedHosts(
      'alpha.tailnet.ts.net, beta.tailnet.ts.net ',
    )).toEqual(['alpha.tailnet.ts.net', 'beta.tailnet.ts.net']);
    expect(resolveAllowedHosts(undefined)).toEqual([]);
  });

  it.each([
    '*',
    '.tailnet.ts.net',
    'https://alpha.tailnet.ts.net',
    'alpha.tailnet.ts.net:3080',
    'alpha.tailnet.ts.net/path',
  ])('rejects a non-exact host entry: %s', (host) => {
    expect(() => resolveAllowedHosts(host)).toThrow(
      'LUCID_WEB_ALLOWED_HOSTS must contain comma-separated exact hostnames.',
    );
  });
});
