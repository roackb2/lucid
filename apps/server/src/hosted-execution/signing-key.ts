import { open, type FileHandle } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import type { ExecutionAuthorityKeyPair } from '@roackb2/heddle-adopter/authority';
import { z } from 'zod';

const MAX_JWK_BYTES = 16 * 1_024;

const PrivateP256JwkSchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]+$/),
  y: z.string().regex(/^[A-Za-z0-9_-]+$/),
  d: z.string().regex(/^[A-Za-z0-9_-]+$/),
}).passthrough();

/** Loads one non-exportable ES256 signing key and its public verification key. */
export async function loadExecutionAuthorityKeyPair(
  filePath: string,
): Promise<ExecutionAuthorityKeyPair> {
  let file: FileHandle | undefined;
  try {
    file = await open(filePath, 'r');
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_JWK_BYTES) {
      throw new Error('Hosted execution signing JWK must be a small regular file.');
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error('Hosted execution signing JWK must not be group- or world-accessible.');
    }
    const encoded = await file.readFile('utf8');
    const jwk = PrivateP256JwkSchema.parse(JSON.parse(encoded) as unknown);
    const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
    const privateKey = await webcrypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
      algorithm,
      false,
      ['sign'],
    );
    const publicKey = await webcrypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      algorithm,
      true,
      ['verify'],
    );
    return { privateKey, publicKey };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Hosted execution')) {
      throw error;
    }
    throw new Error('Hosted execution signing JWK could not be loaded.');
  } finally {
    await file?.close();
  }
}
