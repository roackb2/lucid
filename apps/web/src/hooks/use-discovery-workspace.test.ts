import { describe, expect, it } from 'vitest';
import { resolveWorkspaceRefreshInterval } from './use-discovery-workspace';

describe('workspace refresh policy', () => {
  it('does not restart a failed initial load in the background', () => {
    expect(resolveWorkspaceRefreshInterval(undefined)).toBe(false);
  });

  it('polls a settled workspace at the cadence appropriate to its run state', () => {
    expect(resolveWorkspaceRefreshInterval({
      backgroundChecks: { running: false },
    })).toBe(4_000);
    expect(resolveWorkspaceRefreshInterval({
      backgroundChecks: { running: true },
    })).toBe(700);
  });
});
