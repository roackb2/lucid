import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { FindingView } from '@/lib/trpc';
import { NetworkFindingsLibrary } from './network-findings-library';

const NETWORK_FINDING: FindingView = {
  finding: event({
    sequence: 42,
    kind: 'finding_reported',
    content: 'A local-first deployment kept durable context separate from disposable execution.',
  }),
  sources: [{
    message: event({
      sequence: 31,
      kind: 'shared_message',
      content: 'We retained product memory outside the short-lived execution host.',
    }),
    attribution: {
      agentId: 'kai-agent',
      agentName: 'Kai agent',
      userId: 'kai',
      userDisplayName: 'Kai',
      userKind: 'human',
    },
  }],
  originatingSources: [{
    message: event({
      sequence: 31,
      kind: 'shared_message',
      content: 'We retained product memory outside the short-lived execution host.',
    }),
    attribution: {
      agentId: 'kai-agent',
      agentName: 'Kai agent',
      userId: 'kai',
      userDisplayName: 'Kai',
      userKind: 'human',
    },
  }],
  outboundMessages: [],
  noMatch: false,
  origin: 'ambient-network',
};

const QUIET_CHECK: FindingView = {
  ...NETWORK_FINDING,
  finding: event({
    sequence: 43,
    kind: 'finding_reported',
    content: 'No relevant message surfaced in this check.',
  }),
  noMatch: true,
};

describe('network findings learning slice', () => {
  it('renders a real finding with its peer-authored provenance', () => {
    const markup = renderLibrary([NETWORK_FINDING, QUIET_CHECK]);

    expect(markup).toContain('Network finding available');
    expect(markup).toContain('durable context separate from disposable execution');
    expect(markup).toContain('We retained product memory');
    expect(markup).toContain('Kai');
    expect(markup).toContain('Human user');
    expect(markup).toContain('1 quiet check omitted');
    expect(markup).not.toContain('No relevant message surfaced in this check.');
  });

  it('keeps an honest empty state when only quiet checks exist', () => {
    const markup = renderLibrary([QUIET_CHECK]);

    expect(markup).toContain('No network-derived findings yet');
    expect(markup).toContain('does not fabricate examples');
    expect(markup).toContain('1 completed check is intentionally');
    expect(markup).toContain('Review the current interest');
  });
});

function renderLibrary(findings: FindingView[]): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <NetworkFindingsLibrary findings={findings} />
    </MemoryRouter>,
  );
}

function event(input: {
  sequence: number;
  kind: 'finding_reported' | 'shared_message';
  content: string;
}) {
  return {
    sequence: input.sequence,
    id: `event-${input.sequence}`,
    workspaceId: 'workspace-001',
    wakeNumber: 1,
    kind: input.kind,
    title: 'Experimental network event',
    content: input.content,
    metadata: {},
    createdAt: `2026-08-27T09:${input.sequence}:00.000Z`,
  };
}
