// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobIntelligencePreview } from '../src/client/components/JobIntelligencePreview.js';
import { api } from '../src/client/api.js';
import { extractNlpDocument } from '../src/intelligence/nlp/document.js';
import { projectJobIntelligence } from '../src/intelligence/nlp/projection.js';
import { projectRequirementCoverage } from '../src/intelligence/nlp/requirementCoverageProjection.js';
import { adaptResumeSnapshotEvidence } from '../src/intelligence/nlp/snapshotEvidence.js';
import { projectRoleFamilySuggestion } from '../src/intelligence/nlp/roleFamilySuggestion.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('P11 Job Intelligence coverage UI', () => {
  it('labels evidence coverage as diagnostic and displays provenance', async () => {
    const enrichment = await extractNlpDocument({
      title: 'Analyst',
      location: null,
      description: 'Linux required.',
      requirements: null,
      preferredQualifications: null,
    });
    const coverage = projectRequirementCoverage(
      enrichment,
      adaptResumeSnapshotEvidence({
        snapshotId: 's1',
        interpretationId: 'i1',
        schemaVersion: 1,
        parserVersion: 'resume-parser-v1',
        normalizationVersion: 'resume-normalization-v1',
        parsingStatus: 'parsed',
        normalizedText: 'linux',
        skills: [
          {
            rawLabel: 'Linux',
            provenance: 'resume-extract:name',
            skillId: null,
          },
        ],
        certifications: [],
      }),
    );
    vi.spyOn(api, 'analyzeJobIntelligence').mockResolvedValue({
      ...projectJobIntelligence('job-1', enrichment, {
        clearanceRequirement: null,
        remoteType: 'unknown',
        location: null,
        estimatedExperienceYears: null,
      }),
      roleFamily: projectRoleFamilySuggestion('job-1', {
        title: 'Analyst',
        profile: DEFAULT_SEARCH_PROFILE,
      }),
      coverage,
      coverageSource: {
        snapshotId: 's1',
        parserVersion: 'resume-parser-v1',
        normalizationVersion: 'resume-normalization-v1',
      },
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { mutations: { retry: false } } })
        }
      >
        <JobIntelligencePreview job={{ id: 'job-1' }} />
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Analyze requirements' }),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Diagnostic requirement coverage',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This ratio is diagnostic; it is not a job score/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Snapshot evidence: Linux.*resume-extract:name.*resume-parser-v1/,
      ),
    ).toBeInTheDocument();
  });
});
