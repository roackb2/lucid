import { describe, expect, it } from 'vitest';
import {
  FOUNDATION_HOME_PATH,
  foundationNavigationItems,
  INFORMATION_NETWORK_PREVIEW_HOME_PATH,
  informationNetworkPreviewNavigationItems,
  resolveWorkspaceHomePath,
  resolveWorkspacePageLabel,
} from './app-shell';

describe('Lucid foundation navigation', () => {
  it('returns to Agent and keeps Chat out of primary navigation', () => {
    expect(FOUNDATION_HOME_PATH).toBe('/agent');
    expect(foundationNavigationItems.map(({ label, path }) => ({
      label,
      path,
    }))).toEqual([
      { label: 'Agent', path: '/agent' },
      { label: 'Findings', path: '/findings' },
      { label: 'Interest', path: '/interests' },
    ]);
  });

  it('makes Network the development-preview home without changing the live default', () => {
    expect(INFORMATION_NETWORK_PREVIEW_HOME_PATH).toBe('/network');
    expect(resolveWorkspaceHomePath(true)).toBe('/network');
    expect(resolveWorkspaceHomePath(false)).toBe(FOUNDATION_HOME_PATH);
    expect(informationNetworkPreviewNavigationItems.map(({ label }) => label))
      .toEqual(['Network', 'Findings', 'Interest', 'Agent']);
  });

  it('uses product labels for dynamic Network routes', () => {
    expect(resolveWorkspacePageLabel('/network')).toBe('Network');
    expect(resolveWorkspacePageLabel('/network/posts/post-1')).toBe('Post');
    expect(resolveWorkspacePageLabel('/profiles/profile-1')).toBe('Profile');
    expect(resolveWorkspacePageLabel('/network-lab')).toBe('Network Lab');
  });
});
