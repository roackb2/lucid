/** Configures Lucid's ignored direct-HTTP Execution Host profile. */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateExecutionAuthorityKeyFile,
} from '@heddleagent/execution-host-client/node';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV_PATH = join(REPO_ROOT, '.env');
const DEFAULT_SIGNING_KEY_PATH =
  'local/hosted-execution/es256-private.jwk.json';

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Lucid local Runtime configuration failed: ${message}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const file = await readFile(ENV_PATH, 'utf8').catch(() => {
    throw new Error('Create Lucid .env before configuring the local Runtime.');
  });
  const environment = parseEnvironment(file);
  const transport = environment.get('LUCID_HOSTED_EXECUTION_TRANSPORT');
  if (transport && transport !== 'direct') {
    throw new Error(
      'LUCID_HOSTED_EXECUTION_TRANSPORT is already configured for AgentCore. Remove that profile before selecting the local direct Runtime.',
    );
  }

  const serverPort = environment.get('PORT') || '8081';
  const configuredPublicUrl = environment.get(
    'LUCID_HOSTED_EXECUTION_PUBLIC_URL',
  );
  const publicUrl = configuredPublicUrl?.includes('host.docker.internal')
    ? undefined
    : configuredPublicUrl;
  const localToken = environment.get('LUCID_HOSTED_EXECUTION_LOCAL_TOKEN')
    || randomBytes(32).toString('hex');
  if (localToken.length < 32) {
    throw new Error(
      'LUCID_HOSTED_EXECUTION_LOCAL_TOKEN is already configured but contains fewer than 32 characters.',
    );
  }

  const values = new Map<string, string>([
    ['LUCID_HOSTED_EXECUTION_ENABLED', 'true'],
    ['LUCID_HOSTED_EXECUTION_TRANSPORT', 'direct'],
    [
      'LUCID_HOSTED_EXECUTION_PUBLIC_URL',
      publicUrl || `http://127.0.0.1:${serverPort}`,
    ],
    [
      'LUCID_HOSTED_EXECUTION_HOST_URL',
      environment.get('LUCID_HOSTED_EXECUTION_HOST_URL')
        || 'http://127.0.0.1:18080',
    ],
    ['LUCID_HOSTED_EXECUTION_LOCAL_TOKEN', localToken],
    [
      'LUCID_HOSTED_EXECUTION_SIGNING_JWK_PATH',
      environment.get('LUCID_HOSTED_EXECUTION_SIGNING_JWK_PATH')
        || DEFAULT_SIGNING_KEY_PATH,
    ],
  ]);

  await writeEnvironmentAtomically(file, values);
  const signingKeyPath = resolve(
    REPO_ROOT,
    values.get('LUCID_HOSTED_EXECUTION_SIGNING_JWK_PATH')!,
  );
  if (!(await pathExists(signingKeyPath))) {
    await mkdir(dirname(signingKeyPath), { recursive: true, mode: 0o700 });
    await generateExecutionAuthorityKeyFile(signingKeyPath);
  }
  await chmod(signingKeyPath, 0o600);

  console.log('Configured Lucid for the local direct-HTTP Runtime.');
  console.log('The ignored ingress token and signing key were not printed.');
}

function parseEnvironment(file: string): Map<string, string> {
  return new Map(file.split(/\r?\n/u).flatMap((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    return match ? [[match[1], match[2].trim()] as const] : [];
  }));
}

async function writeEnvironmentAtomically(
  file: string,
  values: ReadonlyMap<string, string>,
): Promise<void> {
  const remaining = new Map(values);
  const lines = file.split(/\r?\n/u).map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/u.exec(line);
    const value = match ? remaining.get(match[1]) : undefined;
    if (value === undefined) {
      return line;
    }
    remaining.delete(match![1]);
    return `${match![1]}=${value}`;
  });
  if (remaining.size > 0) {
    if (lines.at(-1)?.trim()) {
      lines.push('');
    }
    lines.push('# Local direct-HTTP Execution Host');
    lines.push(...[...remaining].map(([name, value]) => `${name}=${value}`));
  }
  const output = `${lines.join('\n').replace(/\n+$/u, '')}\n`;
  const mode = (await stat(ENV_PATH)).mode & 0o777;
  const temporaryPath = `${ENV_PATH}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, output, { encoding: 'utf8', mode });
  await rename(temporaryPath, ENV_PATH);
}

async function pathExists(path: string): Promise<boolean> {
  return await stat(path).then(() => true).catch(() => false);
}
