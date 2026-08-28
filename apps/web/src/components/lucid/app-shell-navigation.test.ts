import { describe, expect, it } from 'vitest';
import {
  FOUNDATION_HOME_PATH,
  foundationNavigationItems,
} from './app-shell';

describe('Lucid foundation navigation', () => {
  it('returns to Findings and keeps Chat out of primary navigation', () => {
    expect(FOUNDATION_HOME_PATH).toBe('/findings');
    expect(foundationNavigationItems.map(({ label, path }) => ({
      label,
      path,
    }))).toEqual([
      { label: 'Findings', path: '/findings' },
      { label: 'Interests', path: '/interests' },
      { label: 'Agent', path: '/agent' },
    ]);
  });
});
