import { describe, expect, it } from 'vitest';

import { classifyNavigation } from '../src/desktop/navigation.js';

describe('desktop navigation security', () => {
  it('keeps internal routes inside the application', () => {
    expect(
      classifyNavigation('http://127.0.0.1:4567/jobs', 'http://127.0.0.1:4567'),
    ).toEqual({
      action: 'allow',
    });
  });

  it('opens web links externally and denies unsafe schemes', () => {
    expect(
      classifyNavigation(
        'https://jobs.example.com/role',
        'http://127.0.0.1:4567',
      ),
    ).toEqual({
      action: 'external',
      url: 'https://jobs.example.com/role',
    });
    expect(
      classifyNavigation(
        'file:///C:/Windows/System32',
        'http://127.0.0.1:4567',
      ),
    ).toEqual({
      action: 'deny',
    });
  });
});
