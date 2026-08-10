import { describe, expect, it } from 'vitest';
import {
  HostedExecutionCredentials,
  resolveHostedExecutionConfig,
} from './config.js';

const LOCAL_TOKEN = 'local-token-'.padEnd(32, 'x');
const MODEL_API_KEY = 'model-key-value';

describe('hosted execution config', () => {
  it('is absent by default', () => {
    expect(resolveHostedExecutionConfig({}, '/repo')).toBeUndefined();
  });

  it('parses the complete local profile and removes ambient credentials', async () => {
    const environment = enabledEnvironment();

    const config = resolveHostedExecutionConfig(environment, '/repo');

    expect(config).toMatchObject({
      adopterId: 'lucid-local',
      tenantId: 'lucid-local',
      productSessionId: 'local-discovery-workspace',
      mcpServerId: 'lucid_product',
      signingJwkPath: '/repo/local/authority.jwk.json',
    });
    expect(config?.credentials.localToken()).toBe(LOCAL_TOKEN);
    await expect(config?.credentials.resolveModelApiKey()).resolves.toBe(
      MODEL_API_KEY,
    );
    expect(environment.LUCID_HOSTED_EXECUTION_LOCAL_TOKEN).toBeUndefined();
    expect(environment.LUCID_HOSTED_EXECUTION_MODEL_API_KEY).toBeUndefined();
    expect(JSON.stringify(config?.credentials)).toBe('{}');
  });

  it('does not expose credential values through routine object inspection', () => {
    const credentials = new HostedExecutionCredentials({
      localToken: LOCAL_TOKEN,
      modelApiKey: MODEL_API_KEY,
    });

    expect(Object.keys(credentials)).toEqual([]);
    expect(JSON.stringify(credentials)).toBe('{}');
    expect(String(credentials)).not.toContain(LOCAL_TOKEN);
    expect(String(credentials)).not.toContain(MODEL_API_KEY);
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
  ])('rejects %s', (_label, override) => {
    expect(() => resolveHostedExecutionConfig({
      ...enabledEnvironment(),
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
    LUCID_HOSTED_EXECUTION_SIGNING_JWK_PATH: 'local/authority.jwk.json',
  };
}
