/** Generates one local ES256 authority key outside version control. */
import { webcrypto } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Lucid hosted execution key generation failed: ${message}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      output: {
        type: 'string',
        default: 'local/hosted-execution/es256-private.jwk.json',
      },
    },
    strict: true,
  });
  const outputPath = resolve(values.output);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const privateJwk = await webcrypto.subtle.exportKey(
    'jwk',
    keyPair.privateKey,
  );
  await writeFile(
    outputPath,
    `${JSON.stringify(privateJwk)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  console.log(`Created private hosted-execution signing key at ${outputPath}.`);
}
