// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstRunPanel } from '../src/client/components/FirstRunPanel.js';
import { AppLayout } from '../src/client/components/AppLayout.js';

const apiMock = vi.hoisted(() => ({
  searchProfile: vi.fn(),
  searchProfileIntelligence: vi.fn(),
  saveSearchProfile: vi.fn(),
  sourceControlCenter: vi.fn(),
  discoveryAlerts: vi.fn(),
  sources: vi.fn(),
  candidates: vi.fn(),
}));

vi.mock('../src/client/api.js', () => ({
  api: apiMock,
  ApiRequestError: Error,
  apiRequestErrorReason: () => null,
  isDefinitiveApiCommandError: () => false,
}));

const SearchProfilePage = (
  await import('../src/client/pages/SearchProfilePage.js')
).SearchProfilePage;

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

function renderWithRouter(node: React.ReactNode, initialPath = '/') {
  return render(
    <QueryClientProvider client={createClient()}>
      <MemoryRouter initialEntries={[initialPath]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.searchProfile.mockReset();
  apiMock.searchProfileIntelligence.mockReset();
  apiMock.saveSearchProfile.mockReset();
  apiMock.sourceControlCenter.mockReset();
  apiMock.discoveryAlerts.mockReset();
  apiMock.sources.mockReset();
  apiMock.candidates.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('Onboarding visible entry points', () => {
  it('FirstRunPanel renders a primary "Start onboarding" link to /onboarding for a first-run user', () => {
    renderWithRouter(<FirstRunPanel hasSources={false} />);
    const link = screen.getByRole('link', { name: /Start onboarding/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/onboarding');
  });

  it('FirstRunPanel renders a "Review search setup" link to /onboarding for an established user', () => {
    renderWithRouter(<FirstRunPanel hasSources={true} />);
    const link = screen.getByRole('link', { name: /Review search setup/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/onboarding');
  });
});

describe('AppLayout sidebar exposes the Search Setup nav entry', () => {
  it('renders a "Search Setup" link to /onboarding', () => {
    apiMock.sourceControlCenter.mockResolvedValue({
      summary: { failedSources: 0, nextScheduledRun: null },
      discovery: { running: false },
    });
    apiMock.discoveryAlerts.mockResolvedValue([]);
    renderWithRouter(<AppLayout />);
    const link = screen.getByRole('link', { name: /Search Setup/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/onboarding');
  });
});

describe('SearchProfilePage exposes a Review search setup link', () => {
  it('renders a "Review search setup" link to /onboarding in the page header', async () => {
    apiMock.searchProfile.mockResolvedValue({
      families: [
        {
          key: 'software-engineering',
          displayName: 'Software engineering',
          enabled: true,
          priority: 0,
          titles: ['Network Engineer'],
        },
      ],
      prioritizeRemote: true,
      maxOnsiteDistanceMiles: 50,
      preferredLocation: '',
      maxExperienceYears: 0,
      maxQueriesPerRun: 40,
    });
    apiMock.searchProfileIntelligence.mockResolvedValue({
      roleFamilies: [],
      skillCoverage: {
        configuredCount: 0,
        recognizedCount: 0,
        unknownLabels: [],
      },
      skillClusters: [],
    });
    renderWithRouter(<SearchProfilePage />, '/search-profile');
    const link = await waitFor(() =>
      screen.getByRole('link', { name: /Review search setup/i }),
    );
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/onboarding');
  });
});
