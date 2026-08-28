import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV_PATH = join(REPO_ROOT, '.env');
const DEFAULT_IMAGE = 'heddle-execution-host:local';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

if (!existsSync(ENV_PATH)) {
  throw new Error('Create Lucid .env before starting the local Execution Host.');
}
loadEnvFile(ENV_PATH);

const enabled = readEnvironment('LUCID_HOSTED_EXECUTION_ENABLED');
if (enabled !== 'true') {
  throw new Error('Set LUCID_HOSTED_EXECUTION_ENABLED=true in Lucid .env.');
}
const transport = process.env.LUCID_HOSTED_EXECUTION_TRANSPORT?.trim()
  || 'direct';
if (transport !== 'direct') {
  throw new Error('The local Runtime command requires direct transport.');
}

const publicUrl = readOrigin('LUCID_HOSTED_EXECUTION_PUBLIC_URL');
if (
  publicUrl.protocol !== 'https:'
  && !(
    publicUrl.protocol === 'http:'
    && LOOPBACK_HOSTS.has(publicUrl.hostname)
  )
) {
  throw new Error(
    'The local container requires an HTTPS public URL or loopback HTTP Lucid origin.',
  );
}
const runtimeCallbackUrl = new URL(publicUrl);
if (runtimeCallbackUrl.protocol === 'http:') {
  runtimeCallbackUrl.hostname = 'host.docker.internal';
}
const hostUrl = readOrigin('LUCID_HOSTED_EXECUTION_HOST_URL');
if (hostUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(hostUrl.hostname)) {
  throw new Error(
    'LUCID_HOSTED_EXECUTION_HOST_URL must be a loopback HTTP origin for the local Runtime.',
  );
}

const localToken = readEnvironment('LUCID_HOSTED_EXECUTION_LOCAL_TOKEN');
if (localToken.length < 32) {
  throw new Error('LUCID_HOSTED_EXECUTION_LOCAL_TOKEN must contain at least 32 characters.');
}
const localTokenSha256 = createHash('sha256')
  .update(localToken)
  .digest('hex');
const image = process.env.LUCID_HOSTED_EXECUTION_LOCAL_IMAGE?.trim()
  || DEFAULT_IMAGE;
const publishedPort = hostUrl.port || '80';
const maxTurnMs = process.env.LUCID_HOSTED_EXECUTION_MAX_TURN_MS?.trim()
  || '600000';
const maxSteps = process.env.LUCID_MAX_STEPS?.trim() || '7';

const runtimeEnvironment = new Map<string, string>([
  ['HEDDLE_EXECUTION_HOST_MODE', 'local'],
  ['HEDDLE_EXECUTION_HOST_ISOLATED', 'true'],
  ['HEDDLE_EXECUTION_HOST_LOCAL_TOKEN_SHA256', localTokenSha256],
  ['HEDDLE_EXECUTION_HOST_EXECUTION_ISSUER', publicUrl.origin],
  [
    'HEDDLE_EXECUTION_HOST_EXECUTION_AUDIENCE',
    process.env.LUCID_HOSTED_EXECUTION_AUDIENCE?.trim()
      || 'urn:heddle-execution-host:lucid-local',
  ],
  [
    'HEDDLE_EXECUTION_HOST_EXECUTION_JWKS_URL',
    new URL('/.well-known/jwks.json', runtimeCallbackUrl).href,
  ],
  ['HEDDLE_EXECUTION_HOST_EXECUTION_JWT_ALGORITHMS', 'ES256'],
  [
    'HEDDLE_EXECUTION_HOST_TRUSTED_ADOPTER_ID',
    process.env.LUCID_HOSTED_EXECUTION_ADOPTER_ID?.trim() || 'lucid-local',
  ],
  [
    'HEDDLE_EXECUTION_HOST_MCP_SERVER_ID',
    process.env.LUCID_HOSTED_EXECUTION_MCP_SERVER_ID?.trim()
      || 'lucid_product',
  ],
  [
    'HEDDLE_EXECUTION_HOST_MCP_SERVER_URL',
    new URL('/hosted-execution/mcp', runtimeCallbackUrl).href,
  ],
  [
    'HEDDLE_EXECUTION_HOST_MCP_AUDIENCE',
    process.env.LUCID_HOSTED_EXECUTION_MCP_AUDIENCE?.trim()
      || 'urn:lucid:mcp:local',
  ],
  ['HEDDLE_EXECUTION_HOST_MODEL', process.env.LUCID_MODEL?.trim() || 'gpt-5.4-mini'],
  ['HEDDLE_EXECUTION_HOST_MAX_STEPS', maxSteps],
  ['HEDDLE_EXECUTION_HOST_MAX_INVOCATION_MS', maxTurnMs],
  ['LOG_LEVEL', process.env.LOG_LEVEL?.trim() || 'info'],
]);
const environmentArguments = [...runtimeEnvironment]
  .flatMap(([name, value]) => ['--env', `${name}=${value}`]);

const result = spawnSync('docker', [
  'run',
  '--rm',
  '--name',
  'lucid-heddle-runtime',
  '--platform',
  'linux/arm64',
  '--publish',
  `127.0.0.1:${publishedPort}:8080`,
  '--cpus',
  '1',
  '--memory',
  '2g',
  '--pids-limit',
  '256',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges',
  ...environmentArguments,
  image,
], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});

if (result.error) {
  throw new Error(
    `Unable to start Docker Runtime: ${result.error.message}. Build ${image} first.`,
  );
}
process.exitCode = result.status ?? 1;

function readEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name} in Lucid .env.`);
  }
  return value;
}

function readOrigin(name: string): URL {
  const url = new URL(readEnvironment(name));
  if (
    (url.pathname !== '/' && url.pathname !== '')
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(`${name} must be an origin without credentials, path, query, or fragment.`);
  }
  return url;
}
