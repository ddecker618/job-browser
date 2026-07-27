import { describe, expect, it } from 'vitest';

import { RemoteOkProvider } from '../src/providers/remoteOk.provider.js';

const request = {
  query: 'security',
  location: null,
  remoteOnly: true,
  limit: 10,
} as const;

describe('RemoteOkProvider fixtures', () => {
  it('accepts only the empty configuration schema', async () => {
    const provider = new RemoteOkProvider();
    await expect(provider.validateConfiguration({})).resolves.toMatchObject({
      valid: true,
    });
    await expect(
      provider.validateConfiguration({ endpoint: 'https://example.test' }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('loads fixture records without a live request', async () => {
    const provider = new RemoteOkProvider();
    const search = await provider.search(request, { fixtureOnly: true });
    const records = await provider.fetch(search);

    expect(search.fixturePath).not.toBeNull();
    expect(records.records).toHaveLength(2);
  });

  it('normalizes and validates provider-specific data', async () => {
    const provider = new RemoteOkProvider();
    const search = await provider.search(request, { fixtureOnly: true });
    const records = await provider.fetch(search);
    const normalized = provider.validate(
      provider.normalize(records.records[0], '2026-07-18T12:00:00.000Z'),
    );

    expect(normalized).toMatchObject({
      title: 'Cybersecurity Analyst',
      normalizedTitle: 'cybersecurity analyst',
      company: 'Example Security Company',
      remoteType: 'remote',
      employmentType: 'full-time',
      sourceType: 'remote-ok',
      status: 'new',
    });
    expect(normalized.description).toBe(
      'Monitor alerts and investigate security events.',
    );
    expect(normalized.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(normalized.datePosted).toBe('2026-07-17T14:00:00.000Z');
  });
});
