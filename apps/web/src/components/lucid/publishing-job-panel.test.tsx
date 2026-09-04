import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { InformationNetworkProfileDetail } from '@/lib/trpc';
import { networkProfileFixture } from '@/test-fixtures/information-network';
import { InformationNetworkProfile } from './information-network-profile-page';
import { PublishingJobPanel } from './publishing-job-panel';

type PublishingJob = InformationNetworkProfileDetail['publishingJobs'][number];

const publishingJob = networkProfileFixture.publishingJobs[0];
if (!publishingJob) {
  throw new Error('The test requires one Publishing job.');
}

describe('PublishingJobPanel', () => {
  it('explains the controlled Publishing job and its preferences', () => {
    const markup = renderPanel(publishingJob);

    expect(markup).toContain('Regional fashion publisher');
    expect(markup).toContain('Ready to research');
    expect(markup).toContain('Publishing preferences');
    expect(markup).toContain('Taiwan and East Asia');
    expect(markup).toContain('Concise, curious, and evidence-led');
    expect(markup).not.toContain('Preferred sources');
    expect(markup).toContain('Only when requested');
    expect(markup).toContain('Run once');
    expect(markup).toContain('timer check does no model work');
    expect(markup).not.toContain('Heddle');
    expect(markup).not.toContain('Runtime');
  });

  it('disables duplicate requests while durable work is queued', () => {
    const markup = renderPanel({
      ...publishingJob,
      latestRunRequest: {
        id: 'publisher-run-1',
        state: 'requested',
        requestedAt: '2026-09-04T06:05:00.000Z',
      },
    });

    expect(markup).toContain('Publishing run queued');
    expect(markup).toContain('Lucid saved the request');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('>Queued<');
  });

  it('links a settled published run to its durable Post', () => {
    const markup = renderPanel({
      ...publishingJob,
      latestRunRequest: {
        id: 'publisher-run-1',
        state: 'settled',
        outcome: 'published',
        outcomeSummary: 'Published after reviewing two current sources.',
        publishedPostId: 'post-from-agent',
        requestedAt: '2026-09-04T06:05:00.000Z',
        settledAt: '2026-09-04T06:07:00.000Z',
      },
    });

    expect(markup).toContain('Post published');
    expect(markup).toContain('Published after reviewing two current sources.');
    expect(markup).toContain('href="/network/posts/post-from-agent"');
    expect(markup).toContain('View published Post');
  });

  it('distinguishes active, no-Post, and failed durable outcomes', () => {
    const working = renderPanel({
      ...publishingJob,
      latestRunRequest: {
        id: 'publisher-run-working',
        state: 'claimed',
        requestedAt: '2026-09-04T06:05:00.000Z',
        claimedAt: '2026-09-04T06:05:01.000Z',
      },
    });
    const noPost = renderPanel({
      ...publishingJob,
      latestRunRequest: {
        id: 'publisher-run-no-post',
        state: 'settled',
        outcome: 'no-post',
        outcomeSummary: 'The available sources were not reliable enough.',
        requestedAt: '2026-09-04T06:05:00.000Z',
        settledAt: '2026-09-04T06:06:00.000Z',
      },
    });
    const failed = renderPanel({
      ...publishingJob,
      latestRunRequest: {
        id: 'publisher-run-failed',
        state: 'settled',
        outcome: 'failed',
        outcomeSummary: 'The research request could not be completed.',
        requestedAt: '2026-09-04T06:05:00.000Z',
        settledAt: '2026-09-04T06:06:00.000Z',
      },
    });

    expect(working).toContain('Agent is working');
    expect(working).toContain('>Working…<');
    expect(noPost).toContain('Completed without publishing');
    expect(noPost).toContain('The available sources were not reliable enough.');
    expect(failed).toContain('Last run failed');
    expect(failed).toContain('The research request could not be completed.');
  });

  it('shows paused and request-error states next to the control', () => {
    const markup = renderPanel(
      { ...publishingJob, enabled: false },
      'Lucid could not request this run.',
    );

    expect(markup).toContain('Publishing is paused');
    expect(markup).toContain('preferences and prior results remain saved');
    expect(markup).toContain('Lucid could not request this run.');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('disabled=""');
  });
});

describe('InformationNetworkProfile', () => {
  it('connects the Profile to its visible Publishing job', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <InformationNetworkProfile
          detail={networkProfileFixture}
          onRunOnce={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('Mina&#x27;s representative');
    expect(markup).toContain('Publishing focus');
    expect(markup).toContain('Regional fashion publisher');
    expect(markup).not.toContain('Publishing job is not connected yet');
  });
});

function renderPanel(job: PublishingJob, actionError?: string): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PublishingJobPanel
        actionError={actionError}
        isRequesting={false}
        job={job}
        onRunOnce={vi.fn()}
      />
    </MemoryRouter>,
  );
}
