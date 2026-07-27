import { describe, expect, it } from 'vitest';

import {
  isPublicIpAddress,
  resolvePublicUrl,
  validatePublicUrl,
} from '../src/security/publicUrlPolicy.js';

describe('public URL policy', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/jobs',
    'https://user:secret@example.com/jobs',
    'http://localhost/jobs',
    'http://service.local/jobs',
    'http://127.0.0.1/jobs',
    'http://169.254.10.20/jobs',
    'http://10.0.0.1/jobs',
    'http://[::1]/jobs',
    'http://[fe80::1]/jobs',
    'http://[fc00::1]/jobs',
    'http://[::ffff:127.0.0.1]/jobs',
  ])('rejects non-public target %s', (url) => {
    expect(() => validatePublicUrl(url)).toThrow();
  });

  it('recognizes public and non-public IP ranges', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicIpAddress('192.168.1.2')).toBe(false);
    expect(isPublicIpAddress('::ffff:10.0.0.1')).toBe(false);
  });

  it('resolves all addresses and rejects a host if any answer is private', async () => {
    await expect(
      resolvePublicUrl('https://jobs.example.test/feed', () =>
        Promise.resolve([
          { address: '203.0.113.10', family: 4 },
          { address: '10.0.0.4', family: 4 },
        ]),
      ),
    ).rejects.toThrow('non-public');
  });

  it('returns validated public DNS answers for connection pinning', async () => {
    const resolved = await resolvePublicUrl(
      'https://jobs.example.test/feed',
      () => Promise.resolve([{ address: '8.8.8.8', family: 4 }]),
    );
    expect(resolved.addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });
});
