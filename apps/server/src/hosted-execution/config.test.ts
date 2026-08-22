import { describe, expect, it } from 'vitest';
import { resolveHostedExecutionConfig } from './config.js';

const LOCAL_TOKEN = 'local-token-'.padEnd(32, 'x');
const MODEL_API_KEY = 'model-key-value';
const DELEGATION_TOKEN = 'delegation-token-'.padEnd(32, 'x');
const COORDINATOR_API_TOKEN = 'coordinator-api-token-'.padEnd(32, 'x');

describe('hosted execution config', () => {
  it('is absent by default', () => {
    expect(resolveHostedExecutionConfig({}, '/repo')).toBeUndefined();
  });

  it('parses the complete direct profile and removes ambient credentials', async () => {
    const environment = enabledEnvironment();

    const config = resolveHostedExecutionConfig(environment, '/repo');

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
    await expect(config?.modelCredentials.resolveModelApiKey({
      scope: {
        tenantId: 'tenant',
        subjectId: 'subject',
        productSessionId: 'session',
      },
      invocationId: 'invocation',
    })).resolves.toBe(
      MODEL_API_KEY,
    );
    expect(environment.LUCID_HOSTED_EXECUTION_LOCAL_TOKEN).toBeUndefined();
    expect(environment.LUCID_HOSTED_EXECUTION_MODEL_API_KEY).toBeUndefined();
    expect(environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN)
      .toBeUndefined();
    expect(environment.LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN)
      .toBeUndefined();
    expect(JSON.stringify(config?.modelCredentials)).toBe('{}');
    expect(config?.heartbeatDelegationCredentials).toBeDefined();
    expect(config?.heartbeatCoordinator?.baseUrl.href)
      .toBe('http://127.0.0.1:18082/');
    expect(JSON.stringify(config?.heartbeatCoordinator?.credentials)).toBe('{}');
  });

  it('parses the AgentCore profile without direct-host credentials', async () => {
    const environment = agentCoreEnvironment();

    const config = resolveHostedExecutionConfig(environment, '/repo');

    expect(config).toMatchObject({
      transport: {
        mode: 'agentcore',
        region: 'us-east-2',
        runtimeArn:
          'arn:aws:bedrock-agentcore:us-east-2:123456789012:runtime/example_runtime',
        qualifier: 'pilot',
      },
    });
    await expect(config?.modelCredentials.resolveModelApiKey({
      scope: {
        tenantId: 'tenant',
        subjectId: 'subject',
        productSessionId: 'session',
      },
      invocationId: 'invocation',
    })).resolves.toBe(MODEL_API_KEY);
    expect(environment.LUCID_HOSTED_EXECUTION_MODEL_API_KEY).toBeUndefined();
    expect(JSON.stringify(config?.modelCredentials)).toBe('{}');
  });

  it('rejects credentials when the profile is disabled', () => {
    expect(() => resolveHostedExecutionConfig({
      LUCID_HOSTED_EXECUTION_ENABLED: 'false',
      LUCID_HOSTED_EXECUTION_LOCAL_TOKEN: LOCAL_TOKEN,
    }, '/repo')).toThrow(
      'Hosted execution credentials are configured',
    );
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
    ['shared coordinator token', {
      LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN: DELEGATION_TOKEN,
    }],
  ])('rejects %s', (_label, override) => {
    expect(() => resolveHostedExecutionConfig({
      ...enabledEnvironment(),
      ...override,
    }, '/repo')).toThrow();
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
    }, '/repo')).toThrow();
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
