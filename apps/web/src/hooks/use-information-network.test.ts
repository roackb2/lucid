import { describe, expect, it } from 'vitest';
import { networkProfileFixture } from '@/test-fixtures/information-network';
import { resolvePublishingJobRefreshInterval } from './use-information-network';

const publishingJob = networkProfileFixture.publishingJobs[0];
if (!publishingJob) {
  throw new Error('The test requires one Publishing job.');
}

describe('Information Network refresh policy', () => {
  it('polls only while a durable Publishing run is active', () => {
    expect(resolvePublishingJobRefreshInterval({
      ...networkProfileFixture,
      publishingJobs: [{
        ...publishingJob,
        latestRunRequest: {
          id: 'publisher-run-1',
          state: 'requested',
          requestedAt: '2026-09-04T06:05:00.000Z',
        },
      }],
    })).toBe(700);

    expect(resolvePublishingJobRefreshInterval({
      ...networkProfileFixture,
      publishingJobs: [{
        ...publishingJob,
        latestRunRequest: {
          id: 'publisher-run-1',
          state: 'claimed',
          requestedAt: '2026-09-04T06:05:00.000Z',
          claimedAt: '2026-09-04T06:05:01.000Z',
        },
      }],
    })).toBe(700);
  });

  it('stops polling when no run is active', () => {
    expect(resolvePublishingJobRefreshInterval(networkProfileFixture)).toBe(false);
    expect(resolvePublishingJobRefreshInterval(undefined)).toBe(false);
    expect(resolvePublishingJobRefreshInterval({
      ...networkProfileFixture,
      publishingJobs: [{
        ...publishingJob,
        latestRunRequest: {
          id: 'publisher-run-1',
          state: 'settled',
          outcome: 'no-post',
          requestedAt: '2026-09-04T06:05:00.000Z',
          settledAt: '2026-09-04T06:06:00.000Z',
        },
      }],
    })).toBe(false);
  });
});
