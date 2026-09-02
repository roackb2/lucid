import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_HOME_PATH,
  workspaceNavigationItems,
  resolveWorkspacePageLabel,
} from './app-shell';

describe('Lucid workspace navigation', () => {
  it('uses Network as home and keeps Chat out of primary navigation', () => {
    expect(WORKSPACE_HOME_PATH).toBe('/network');
    expect(workspaceNavigationItems.map(({ label, path }) => ({
      label,
      path,
    }))).toEqual([
      { label: 'Network', path: '/network' },
      { label: 'Findings', path: '/findings' },
      { label: 'Interest', path: '/interests' },
      { label: 'Agent', path: '/agent' },
    ]);
  });

  it('uses product labels for dynamic Network routes', () => {
    expect(resolveWorkspacePageLabel('/network')).toBe('Network');
    expect(resolveWorkspacePageLabel('/network/posts/post-1')).toBe('Post');
    expect(resolveWorkspacePageLabel('/profiles/profile-1')).toBe('Profile');
    expect(resolveWorkspacePageLabel('/unknown')).toBe('Network');
  });
});
