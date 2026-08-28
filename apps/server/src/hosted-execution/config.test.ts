import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initializeLocalCredentialBundle,
} from '@heddleagent/execution-host-client/node';
import { describe, expect, it } from 'vitest';
import { resolveHostedExecutionConfig } from './config.js';

const LOCAL_TOKEN = 'local-token-'.padEnd(32, 'x');
const MODEL_API_KEY = 'model-key-value';
const DELEGATION_TOKEN = 'delegation-token-'.padEnd(32, 'x');
const COORDINATOR_API_TOKEN = 'coordinator-api-token-'.padEnd(32, 'x');
const RUNTIME = {
  repoRoot: '/repo',
  model: 'gpt-5.4-mini',
};

describe('hosted execution config', () => {
  it('is absent by default', () => {
    expect(resolveHostedExecutionConfig({}, RUNTIME)).toBeUndefined();
  });

  it('parses the complete direct profile and removes ambient credentials', async () => {
    const environment = enabledEnvironment();

    const config = resolveHostedExecutionConfig(environment, RUNTIME);

    expect(config).toMatchObject({
      adopterId: 'lucid-local',
      tenantId: 'lucid-local',
      productSessionId: 'local-discovery-workspace',
      mcpServerId: 'lucid_product',
      signingJwkPath: '/repo/local/authority.jwk.json',
      transport: { mode: 'direct' },
    });
    expect(config?.transport.mode === 'direct'
      ? config.transport.credentials.localToken()
      : undefined).toBe(LOCAL_TOKEN);
    await expect(config?.modelCredentials.resolveModelCredential({
      scope: {
        tenantId: 'tenant',
        subjectId: 'subject',
        productSessionId: 'session',
      },
      invocationId: 'invocation',
    })).resolves.toEqual({
      type: 'api-key',
      apiKey: MODEL_API_KEY,
    });
    expect(environment.LUCID_HOSTED_EXECUTION_LOCAL_TOKEN).toBeUndefined();
    expect(environment.LUCID_HOSTED_EXECUTION_MODEL_API_KEY).toBeUndefined();
    expect(environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN)
      .toBeUndefined();
    expect(environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN)
      .toBeUndefined();
    expect(JSON.stringify(config?.modelCredentials)).toBe('{}');
    expect(config?.heartbeatDelegationToken).toBe(DELEGATION_TOKEN);
    expect(config?.heartbeatCoordinator.baseUrl.href)
      .toBe('http://127.0.0.1:18082/');
    expect(config?.heartbeatCoordinator.apiToken).toBe(COORDINATOR_API_TOKEN);
  });

  it('consumes one generic local credential bundle with local defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lucid-hosted-credentials-'));
    const initialized = await initializeLocalCredentialBundle(
      join(root, 'credentials'),
    );
    const localToken = (await readFile(
      initialized.paths.executionHostLocalToken,
      'utf8',
    )).trimEnd();
    const delegationToken = (await readFile(
      initialized.paths.coordinatorAdopterDelegationToken,
      'utf8',
    )).trimEnd();
    const coordinatorApiToken = (await readFile(
      initialized.paths.coordinatorApiToken,
      'utf8',
    )).trimEnd();
    const environment = {
      LUCID_HOSTED_EXECUTION_ENABLED: 'true',
      LUCID_HOSTED_EXECUTION_CREDENTIAL_DIRECTORY:
        initialized.paths.directory,
    };

    try {
      const config = resolveHostedExecutionConfig(environment, RUNTIME);

      expect(config).toMatchObject({
        publicBaseUrl: new URL('http://127.0.0.1:8081'),
        signingJwkPath: initialized.paths.executionAuthorityPrivateJwk,
        heartbeatDelegationToken: delegationToken,
        heartbeatCoordinator: {
          baseUrl: new URL('http://127.0.0.1:18082'),
          apiToken: coordinatorApiToken,
        },
        transport: {
          mode: 'direct',
          baseUrl: new URL('http://127.0.0.1:18080'),
        },
      });
      expect(config?.transport.mode === 'direct'
        ? config.transport.credentials.localToken()
        : undefined).toBe(localToken);
      expect(environment).not.toHaveProperty(
        'LUCID_HOSTED_EXECUTION_LOCAL_TOKEN_FILE',
      );
      expect(environment).not.toHaveProperty(
        'LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN_FILE',
      );
      expect(environment).not.toHaveProperty(
        'LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN_FILE',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts an explicit mounted model credential', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lucid-model-credential-'));
    const modelKeyPath = join(root, 'model-api-key');
    await writeFile(modelKeyPath, `${MODEL_API_KEY}\n`, { mode: 0o400 });
    const environment = {
      ...enabledEnvironment(),
      LUCID_HOSTED_EXECUTION_MODEL_API_KEY: undefined,
      LUCID_HOSTED_EXECUTION_MODEL_API_KEY_FILE: modelKeyPath,
    };

    try {
      const config = resolveHostedExecutionConfig(environment, RUNTIME);
      await expect(config?.modelCredentials.resolveModelCredential({
        scope: {
          tenantId: 'tenant',
          subjectId: 'subject',
          productSessionId: 'session',
        },
        invocationId: 'invocation',
      })).resolves.toEqual({ type: 'api-key', apiKey: MODEL_API_KEY });
      expect(environment.LUCID_HOSTED_EXECUTION_MODEL_API_KEY_FILE)
        .toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('parses the AgentCore profile without direct-host credentials', async () => {
    const environment = agentCoreEnvironment();

    const config = resolveHostedExecutionConfig(environment, RUNTIME);

    expect(config).toMatchObject({
      transport: {
        mode: 'agentcore',
        region: 'us-east-2',
        runtimeArn:
          'arn:aws:bedrock-agentcore:us-east-2:123456789012:runtime/example_runtime',
        qualifier: 'pilot',
      },
    });
    await expect(config?.modelCredentials.resolveModelCredential({
      scope: {
        tenantId: 'tenant',
        subjectId: 'subject',
        productSessionId: 'session',
      },
      invocationId: 'invocation',
    })).resolves.toEqual({
      type: 'api-key',
      apiKey: MODEL_API_KEY,
    });
    expect(environment.LUCID_HOSTED_EXECUTION_MODEL_API_KEY).toBeUndefined();
    expect(JSON.stringify(config?.modelCredentials)).toBe('{}');
  });

  it('uses the Heddle account credential when no hosted API key is configured', () => {
    const environment = enabledEnvironment();
    delete environment.LUCID_HOSTED_EXECUTION_MODEL_API_KEY;

    const config = resolveHostedExecutionConfig(environment, RUNTIME);

    expect(config).toBeDefined();
    expect(environment.LUCID_HOSTED_EXECUTION_MODEL_API_KEY).toBeUndefined();
    expect(JSON.stringify(config?.modelCredentials)).toBe('{}');
  });

  it('rejects the Docker-only callback alias as an authority issuer', () => {
    const environment = enabledEnvironment();
    environment.LUCID_HOSTED_EXECUTION_PUBLIC_URL =
      'http://host.docker.internal:8081';

    expect(() => resolveHostedExecutionConfig(environment, RUNTIME)).toThrow();
  });

  it('rejects credentials when the profile is disabled', () => {
    expect(() => resolveHostedExecutionConfig({
      LUCID_HOSTED_EXECUTION_ENABLED: 'false',
      LUCID_HOSTED_EXECUTION_LOCAL_TOKEN: LOCAL_TOKEN,
    }, RUNTIME)).toThrow(
      'Hosted execution credentials are configured',
    );

    expect(() => resolveHostedExecutionConfig({
      LUCID_HOSTED_EXECUTION_ENABLED: 'false',
      LUCID_HOSTED_EXECUTION_LOCAL_TOKEN_FILE: '/run/secrets/local-token',
    }, RUNTIME)).toThrow('Hosted execution credentials are configured');
  });

  it('rejects mixing the bundle directory with individual bundle fields', () => {
    expect(() => resolveHostedExecutionConfig({
      LUCID_HOSTED_EXECUTION_ENABLED: 'true',
      LUCID_HOSTED_EXECUTION_CREDENTIAL_DIRECTORY: '/credentials',
      LUCID_HOSTED_EXECUTION_LOCAL_TOKEN: LOCAL_TOKEN,
    }, RUNTIME)).toThrow(/cannot be combined/);
  });

  it.each([
    ['public non-TLS URL', {
      LUCID_HOSTED_EXECUTION_PUBLIC_URL: 'http://example.com',
    }],
    ['host URL credentials', {
      LUCID_HOSTED_EXECUTION_HOST_URL: 'https://user:secret@example.com',
    }],
    ['shared token audience', {
      LUCID_HOSTED_EXECUTION_MCP_AUDIENCE:
        'urn:heddle-execution-host:lucid-local',
    }],
    ['direct profile with AgentCore config', {
      LUCID_HOSTED_EXECUTION_AGENTCORE_REGION: 'us-east-2',
    }],
    ['coordinator URL without API token', {
      LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN: undefined,
    }],
    ['profile without a public URL', {
      LUCID_HOSTED_EXECUTION_PUBLIC_URL: undefined,
    }],
    ['profile without a coordinator URL', {
      LUCID_HOSTED_HEARTBEAT_COORDINATOR_URL: undefined,
    }],
    ['coordinator profile without delegation token', {
      LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN: undefined,
    }],
    ['shared coordinator token', {
      LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN: DELEGATION_TOKEN,
    }],
  ])('rejects %s', (_label, override) => {
    expect(() => resolveHostedExecutionConfig({
      ...enabledEnvironment(),
      ...override,
    }, RUNTIME)).toThrow();
  });

  it.each([
    ['missing region', { LUCID_HOSTED_EXECUTION_AGENTCORE_REGION: undefined }],
    ['missing Runtime ARN', {
      LUCID_HOSTED_EXECUTION_AGENTCORE_RUNTIME_ARN: undefined,
    }],
    ['direct URL configured', {
      LUCID_HOSTED_EXECUTION_HOST_URL: 'http://127.0.0.1:8080',
    }],
    ['direct token configured', {
      LUCID_HOSTED_EXECUTION_LOCAL_TOKEN: LOCAL_TOKEN,
    }],
  ])('rejects AgentCore profile with %s', (_label, override) => {
    expect(() => resolveHostedExecutionConfig({
      ...agentCoreEnvironment(),
      ...override,
    }, RUNTIME)).toThrow();
  });
});

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    LUCID_HOSTED_EXECUTION_ENABLED: 'true',
    LUCID_HOSTED_EXECUTION_PUBLIC_URL: 'http://127.0.0.1:8081',
    LUCID_HOSTED_EXECUTION_HOST_URL: 'http://127.0.0.1:8080',
    LUCID_HOSTED_EXECUTION_LOCAL_TOKEN: LOCAL_TOKEN,
    LUCID_HOSTED_EXECUTION_MODEL_API_KEY: MODEL_API_KEY,
    LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN: DELEGATION_TOKEN,
    LUCID_HOSTED_HEARTBEAT_COORDINATOR_URL: 'http://127.0.0.1:18082',
    LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN: COORDINATOR_API_TOKEN,
    LUCID_HOSTED_EXECUTION_SIGNING_JWK_PATH: 'local/authority.jwk.json',
  };
}

function agentCoreEnvironment(): NodeJS.ProcessEnv {
  const environment = enabledEnvironment();
  delete environment.LUCID_HOSTED_EXECUTION_HOST_URL;
  delete environment.LUCID_HOSTED_EXECUTION_LOCAL_TOKEN;
  return {
    ...environment,
    LUCID_HOSTED_EXECUTION_TRANSPORT: 'agentcore',
    LUCID_HOSTED_EXECUTION_AGENTCORE_REGION: 'us-east-2',
    LUCID_HOSTED_EXECUTION_AGENTCORE_RUNTIME_ARN:
      'arn:aws:bedrock-agentcore:us-east-2:123456789012:runtime/example_runtime',
    LUCID_HOSTED_EXECUTION_AGENTCORE_QUALIFIER: 'pilot',
  };
}
