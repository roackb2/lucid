import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { SettingsFoundationPage } from './workspace-foundation-pages';

describe('workspace foundation page readiness', () => {
  it('marks the unbuilt Settings surface without obscuring its real runtime summary', () => {
    const snapshot = {
      runtime: {
        model: 'gpt-5.4-mini',
        heddleVersion: '8.0.0',
      },
    } as DiscoverySnapshot;

    const markup = renderToStaticMarkup(
      <SettingsFoundationPage snapshot={snapshot} />,
    );

    expect(markup).toContain('Not yet built');
    expect(markup).toContain('Settings are not yet built');
    expect(markup).toContain('The runtime summary below is real and read-only');
    expect(markup).toContain('gpt-5.4-mini');
    expect(markup).toContain('8.0.0');
  });
});
