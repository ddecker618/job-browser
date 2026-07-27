import { describe, expect, it } from 'vitest';

import { sanitizeLogContext } from '../src/logging/sanitizeContext.js';

describe('log sanitization', () => {
  it('redacts USAJOBS credentials recursively', () => {
    expect(
      sanitizeLogContext({
        apiKey: 'secret-key',
        nested: {
          Authorization: 'secret',
          email: 'person@example.com',
          safe: 'visible',
        },
      }),
    ).toEqual({
      apiKey: '[redacted]',
      nested: {
        Authorization: '[redacted]',
        email: '[redacted]',
        safe: 'visible',
      },
    });
  });
});
