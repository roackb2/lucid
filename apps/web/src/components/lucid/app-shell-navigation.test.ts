import { describe, expect, it } from 'vitest';
import {
  FOUNDATION_HOME_PATH,
  foundationNavigationItems,
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
      { label: 'Interests', path: '/interests' },
    ]);
  });
});
