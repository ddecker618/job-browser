// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobIntelligencePreview } from '../src/client/components/JobIntelligencePreview.js';
import { api } from '../src/client/api.js';
import { projectJobIntelligence } from '../src/intelligence/nlp/projection.js';
import { projectRoleFamilySuggestion } from '../src/intelligence/nlp/roleFamilySuggestion.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
import { extractNlpDocument } from '../src/intelligence/nlp/document.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function show() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <JobIntelligencePreview job={{ id: 'job-1' }} />
    </QueryClientProvider>,
  );
}
describe('connected Job Intelligence preview', () => {
  it('waits for an explicit action and displays extracted description evidence', async () => {
    const result = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description: 'Linux required.',
      requirements: null,
      preferredQualifications: null,
    });
    const call = vi.spyOn(api, 'analyzeJobIntelligence').mockResolvedValue({
      ...projectJobIntelligence('job-1', result, {
        clearanceRequirement: null,
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: null,
      }),
      coverage: null,
      coverageSource: null,
      roleFamily: projectRoleFamilySuggestion('job-1', {
        title: 'Analyst',
        profile: DEFAULT_SEARCH_PROFILE,
      }),
    });
    show();
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Analyze requirements' }),
    );
    expect(await screen.findByText('Linux required.')).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith('job-1');
    expect(
      screen.getByText(/Nothing here asserts anything about you/),
    ).toBeInTheDocument();
  });
  it('shows actionable failures without inventing results', async () => {
    vi.spyOn(api, 'analyzeJobIntelligence').mockRejectedValue(
      new Error('Job changed during analysis. Retry.'),
    );
    show();
    fireEvent.click(
      screen.getByRole('button', { name: 'Analyze requirements' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Retry');
  });
});
