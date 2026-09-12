// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobIntelligencePreview } from '../src/client/components/JobIntelligencePreview.js';
import { api, ApiRequestError } from '../src/client/api.js';
import { projectJobIntelligence } from '../src/intelligence/nlp/projection.js';
import { buildNlpComparisonReport } from '../src/intelligence/nlp/comparison.js';
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
  function analysisResult() {
    return async () => {
      const result = await extractNlpDocument({
        title: 'Analyst',
        location: null,
        description: 'Linux required.',
        requirements: null,
        preferredQualifications: null,
      });
      const deterministic = {
        clearanceRequirement: null,
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: null,
      };
      return {
        ...projectJobIntelligence('job-1', result, deterministic),
        comparison: buildNlpComparisonReport('job-1', result, deterministic),
        coverage: null,
        coverageSource: null,
        roleFamily: projectRoleFamilySuggestion('job-1', {
          title: 'Analyst',
          profile: DEFAULT_SEARCH_PROFILE,
        }),
      };
    };
  }
  it('waits for an explicit action and displays extracted description evidence', async () => {
    const call = vi
      .spyOn(api, 'analyzeJobIntelligence')
      .mockImplementation(analysisResult());
    vi.spyOn(api, 'jobIntelligence').mockRejectedValue(
      new ApiRequestError(
        404,
        'nlp_no_analysis',
        'No current analysis exists for this job.',
      ),
    );
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
    expect(
      screen.getByRole('button', { name: 'Re-analyze requirements' }),
    ).toBeInTheDocument();
  });
  it('shows actionable failures without inventing results', async () => {
    vi.spyOn(api, 'analyzeJobIntelligence').mockRejectedValue(
      new Error('Job changed during analysis. Retry.'),
    );
    vi.spyOn(api, 'jobIntelligence').mockRejectedValue(
      new ApiRequestError(
        404,
        'nlp_no_analysis',
        'No current analysis exists for this job.',
      ),
    );
    show();
    fireEvent.click(
      screen.getByRole('button', { name: 'Analyze requirements' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Retry');
  });
  it('reopens with the current cached analysis and offers a re-analysis action', async () => {
    const result = await analysisResult()();
    vi.spyOn(api, 'jobIntelligence').mockResolvedValue(result);
    const call = vi.spyOn(api, 'analyzeJobIntelligence');
    show();
    expect(await screen.findByText('Linux required.')).toBeInTheDocument();
    expect(call).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Re-analyze requirements' }),
    ).toBeInTheDocument();
  });
  it('indicates a genuinely disabled capability without an actionable button', async () => {
    vi.spyOn(api, 'jobIntelligence').mockRejectedValue(
      new ApiRequestError(
        409,
        'nlp_capability_disabled',
        'Job Intelligence explanations are disabled.',
        { capability: 'jobIntelligenceExplanation' },
      ),
    );
    vi.spyOn(api, 'analyzeJobIntelligence');
    show();
    expect(
      await screen.findByText(/Job Intelligence is disabled on this device/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
