import { webcrypto } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JoseExecutionAuthority } from '@roackb2/heddle-adopter/authority';
import { afterEach, describe, expect, it } from 'vitest';
import { loadExecutionAuthorityKeyPair } from './signing-key.js';

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => (
    rm(root, { recursive: true, force: true })
  )));
  temporaryRoots.clear();
});

describe('execution authority signing key loader', () => {
  it('loads a private P-256 JWK without making the signing key exportable', async () => {
    const path = await writePrivateJwk(0o600);

    const keyPair = await loadExecutionAuthorityKeyPair(path);
    const authority = await JoseExecutionAuthority.create({
      issuer: 'https://lucid.example',
      adopterId: 'lucid-local',
      executionAudience: 'urn:execution',
      keyId: 'local-key',
      executionTtlSeconds: 60,
    }, keyPair);

    expect(keyPair.privateKey.extractable).toBe(false);
    expect(keyPair.publicKey.extractable).toBe(true);
    expect(authority.publicJwks().keys).toEqual([
      expect.objectContaining({
        kty: 'EC',
        crv: 'P-256',
        kid: 'local-key',
      }),
    ]);
    expect(JSON.stringify(authority.publicJwks())).not.toContain('"d"');
  });

  it('rejects a group-readable private key', async () => {
    const path = await writePrivateJwk(0o640);

    await expect(loadExecutionAuthorityKeyPair(path)).rejects.toThrow(
      'must not be group- or world-accessible',
    );
  });

  it('does not reflect malformed private-key contents', async () => {
    const root = await createTemporaryRoot();
    const path = join(root, 'private.jwk.json');
    await writeFile(path, '{"secret":"do-not-reflect"}', { mode: 0o600 });

    await expect(loadExecutionAuthorityKeyPair(path)).rejects.toThrow(
      'could not be loaded',
    );
  });
});

async function writePrivateJwk(mode: number): Promise<string> {
  const root = await createTemporaryRoot();
  const path = join(root, 'private.jwk.json');
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const privateJwk = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey);
  await writeFile(path, JSON.stringify(privateJwk), { mode });
  return path;
}

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lucid-authority-key-'));
  temporaryRoots.add(root);
  return root;
}
