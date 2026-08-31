import { describe, expect, it } from 'vitest';
import { previewInformationNetworkRepository } from './preview-information-network-repository';

describe('Information Network preview repository', () => {
  it('projects deterministic Posts with accountable Profiles and visible Sources', () => {
    const firstRead = previewInformationNetworkRepository.readNetworkFeed();
    const secondRead = previewInformationNetworkRepository.readNetworkFeed();

    expect(secondRead).toEqual(firstRead);
    expect(firstRead.entries).toHaveLength(3);
    expect(firstRead.entries.every(({ post }) => post.sources.length > 0))
      .toBe(true);
    expect(firstRead.entries.map(({ author }) => author.displayName))
      .toEqual(['Mina Chen', 'Ari Rivera', 'Noah Kim']);
  });

  it('models publishing as an Agent job with separate Publishing preferences', () => {
    const mina = previewInformationNetworkRepository.readNetworkProfile('mina-chen');

    expect(mina?.profile.publishingJob.name)
      .toBe('Regional fashion publishing');
    expect(mina?.profile.publishingJob.publishingPreferences.tone)
      .toContain('Observational');
    expect(mina?.profile.publishingJob.capabilities.map(({ name }) => name))
      .toEqual([
        'Search the public web',
        'Publish text Posts',
        'Upload files',
      ]);
  });

  it('returns null for unknown route identities instead of inventing a fallback', () => {
    expect(previewInformationNetworkRepository.readNetworkPost('missing'))
      .toBeNull();
    expect(previewInformationNetworkRepository.readNetworkProfile('missing'))
      .toBeNull();
  });
});
