import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getHostedAccessToken,
  setHostedAccessToken,
} from '@/lib/trpc';
import { replaceLegacyHostedAccessToken } from './legacy-hosted-access';

describe('legacy hosted access', () => {
  afterEach(() => {
    setHostedAccessToken('');
  });

  it('clears cached user data before installing a replacement token', () => {
    const queryClient = new QueryClient();
    const historyKey = ['hosted-conversation', 'history'] as const;
    const workspaceKey = ['discovery', 'workspace'] as const;
    queryClient.setQueryData(historyKey, [{ prompt: 'private prompt' }]);
    queryClient.setQueryData(workspaceKey, { interest: 'private interest' });

    replaceLegacyHostedAccessToken(queryClient, 'replacement-token');

    expect(queryClient.getQueryData(historyKey)).toBeUndefined();
    expect(queryClient.getQueryData(workspaceKey)).toBeUndefined();
    expect(getHostedAccessToken()).toBe('replacement-token');
  });
});
