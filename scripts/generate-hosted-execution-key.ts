/** Generates one local ES256 authority key outside version control. */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  generateExecutionAuthorityKeyFile,
} from '@roackb2/heddle-adopter/node';

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
  await generateExecutionAuthorityKeyFile(outputPath);
  console.log(`Created private hosted-execution signing key at ${outputPath}.`);
}
