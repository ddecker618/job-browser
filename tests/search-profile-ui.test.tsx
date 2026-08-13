// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchProfilePage } from '../src/client/pages/SearchProfilePage.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Search Profile UI', () => {
  it('loads the profile and issues a PUT when the profile is edited and saved', async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string; body?: unknown }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
      return DEFAULT_SEARCH_PROFILE;
    });
    renderPage(<SearchProfilePage />);

    await screen.findByText('Discovery configuration');
    expect(screen.getByText(/42 job titles across 6 enabled role families/))
      .toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Splunk/ }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.url.endsWith('/api/search-profile') && call.method === 'PUT',
        ),
      ).toBe(true),
    );
    const put = calls.find(
      (call) => call.url.endsWith('/api/search-profile') && call.method === 'PUT',
    );
    const sent = JSON.parse(
      typeof put?.body === 'string' ? put.body : '{}',
    ) as {
      families: { key: string; enabled: boolean }[];
    };
    expect(sent.families.find((f) => f.key === 'splunk')?.enabled).toBe(false);
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
  });

  it('surfaces a save failure instead of silently dropping the error', async () => {
    const user = userEvent.setup();
    mockFetch((url, init) => {
      if (init?.method === 'PUT') {
        return {
          status: 400,
          body: { error: 'Weights must total 100' },
        };
      }
      return DEFAULT_SEARCH_PROFILE;
    });
    renderPage(<SearchProfilePage />);

    await screen.findByText('Discovery configuration');
    await user.click(screen.getByRole('checkbox', { name: /Networking/ }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(
      await screen.findByText('Weights must total 100'),
    ).toBeInTheDocument();
  });
});

function renderPage(element: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/search-profile']}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => unknown,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const result = handler(url, init);
      const response = isErrorResult(result)
        ? new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
      return Promise.resolve(response);
    }),
  );
}

function isErrorResult(
  value: unknown,
): value is { status: number; body: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'body' in value
  );
}