import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { FoundationPage } from './foundation-page';
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

  it('marks prototype pages as non-live data', () => {
    const markup = renderToStaticMarkup(
      <FoundationPage
        description="Deterministic front-end content."
        eyebrow="Product review"
        readiness="preview"
        title="Network"
      >
        <div>Preview content</div>
      </FoundationPage>,
    );

    expect(markup).toContain('Prototype data');
    expect(markup).toContain('data-state="preview"');
  });

  it('distinguishes persisted fixtures from agent-authored live data', () => {
    const markup = renderToStaticMarkup(
      <FoundationPage
        description="Persisted development records."
        eyebrow="Product proof"
        readiness="fixture"
        title="Network"
      >
        <div>Server-backed content</div>
      </FoundationPage>,
    );

    expect(markup).toContain('Server-backed fixtures');
    expect(markup).toContain('data-state="fixture"');
  });
});
