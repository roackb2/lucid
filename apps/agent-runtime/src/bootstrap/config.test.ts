import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig } from './config.js';

describe('runtime configuration', () => {
  it('requires explicit local isolation and a strong local token', () => {
    expect(() => loadRuntimeConfig({ LUCID_AGENT_RUNTIME_MODE: 'local' })).toThrow(
      /ISOLATED=true/,
    );
    expect(() => loadRuntimeConfig({
      LUCID_AGENT_RUNTIME_MODE: 'local',
      LUCID_AGENT_RUNTIME_ISOLATED: 'true',
    })).toThrow(/LOCAL_TOKEN/);
  });

  it('accepts only a one-way local token verifier', () => {
    const config = loadRuntimeConfig({
      LUCID_AGENT_RUNTIME_MODE: 'local',
      LUCID_AGENT_RUNTIME_ISOLATED: 'true',
      LUCID_AGENT_RUNTIME_LOCAL_TOKEN_SHA256: 'a'.repeat(64),
    });
    expect(config.localTokenSha256).toBe('a'.repeat(64));
  });

  it('rejects a plaintext token in the runtime environment', () => {
    expect(() => loadRuntimeConfig({
      LUCID_AGENT_RUNTIME_MODE: 'local',
      LUCID_AGENT_RUNTIME_ISOLATED: 'true',
      LUCID_AGENT_RUNTIME_LOCAL_TOKEN: 't'.repeat(32),
    })).toThrow(/plaintext local token/);
  });

  it('rejects model, database, and static AWS credentials in ambient env', () => {
    expect(() => loadRuntimeConfig({
      LUCID_AGENT_RUNTIME_MODE: 'agentcore',
      OPENAI_API_KEY: 'must-not-be-in-env',
      LUCID_DATABASE_URL: 'postgresql://secret',
      AWS_SECRET_ACCESS_KEY: 'secret',
    })).toThrow(/AWS_SECRET_ACCESS_KEY.*LUCID_DATABASE_URL|LUCID_DATABASE_URL.*AWS_SECRET_ACCESS_KEY/);
  });

  it('allows AgentCore mode to rely on the managed SigV4 ingress', () => {
    const config = loadRuntimeConfig({ LUCID_AGENT_RUNTIME_MODE: 'agentcore' });
    expect(config).toMatchObject({ mode: 'agentcore', host: '0.0.0.0', port: 8080 });
  });
});
