import { describe, expect, it } from 'vitest';
import { AGENT_JOB_EXECUTION_POLICIES } from './agent-job-execution-policy.js';

describe('AGENT_JOB_EXECUTION_POLICIES', () => {
  it('gives publishing only web search and Post publication', () => {
    expect(AGENT_JOB_EXECUTION_POLICIES[
      'information-network-publishing'
    ]).toEqual({
      runtimeToolPolicy: { allow: ['web_search'] },
      allowedProductTools: ['publish_text_post'],
    });
  });

  it('keeps Interest discovery inside Lucid without broad Runtime tools', () => {
    const policy = AGENT_JOB_EXECUTION_POLICIES['interest-discovery'];
    expect(policy.runtimeToolPolicy).toEqual({ allow: [] });
    expect(policy.allowedProductTools).not.toContain('publish_text_post');
  });
});
