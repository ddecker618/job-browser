// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobIntelligencePreview } from '../src/client/components/JobIntelligencePreview.js';
import {
  api,
  ApiRequestError,
  type JobIntelligenceResult,
} from '../src/client/api.js';
import { extractNlpDocument } from '../src/intelligence/nlp/document.js';
import { projectJobIntelligence } from '../src/intelligence/nlp/projection.js';
import { buildNlpComparisonReport } from '../src/intelligence/nlp/comparison.js';
import { projectRequirementCoverage } from '../src/intelligence/nlp/requirementCoverageProjection.js';
import { adaptResumeSnapshotEvidence } from '../src/intelligence/nlp/snapshotEvidence.js';
import { projectRoleFamilySuggestion } from '../src/intelligence/nlp/roleFamilySuggestion.js';
import { DEFAULT_SEARCH_PROFILE } from '../src/config/search-profile.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('P11 Job Intelligence coverage UI', () => {
  async function baseAnalysis(overrides: {
    coverage: JobIntelligenceResult['coverage'];
    coverageSource: JobIntelligenceResult['coverageSource'];
    coverageContext: JobIntelligenceResult['coverageContext'];
  }): Promise<JobIntelligenceResult> {
    const enrichment = await extractNlpDocument({
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
      ...projectJobIntelligence('job-1', enrichment, deterministic),
      comparison: buildNlpComparisonReport('job-1', enrichment, deterministic),
      roleFamily: projectRoleFamilySuggestion('job-1', {
        title: 'Analyst',
        profile: DEFAULT_SEARCH_PROFILE,
      }),
      ...overrides,
    };
  }
  function renderPreview(): void {
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
  function mockAnalyze(result: JobIntelligenceResult): void {
    vi.spyOn(api, 'jobIntelligence').mockRejectedValue(
      new ApiRequestError(
        404,
        'nlp_no_analysis',
        'No current analysis exists for this job.',
      ),
    );
    vi.spyOn(api, 'analyzeJobIntelligence').mockResolvedValue(result);
  }
  it('labels evidence coverage as diagnostic and displays provenance', async () => {
    const coverage = projectRequirementCoverage(
      await extractNlpDocument({
        title: 'Analyst',
        location: null,
        description: 'Linux required.',
        requirements: null,
        preferredQualifications: null,
      }),
      adaptResumeSnapshotEvidence({
        snapshotId: 's1',
        interpretationId: 'i1',
        schemaVersion: 1,
        parserVersion: 'resume-parser-v1',
        normalizationVersion: 'resume-normalization-v1',
        parsingStatus: 'parsed',
        parsingError: null,
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
    mockAnalyze(
      await baseAnalysis({
        coverage,
        coverageSource: {
          snapshotId: 's1',
          parserVersion: 'resume-parser-v1',
          normalizationVersion: 'resume-normalization-v1',
        },
        coverageContext: { captureState: 'parsed', parsingError: null },
      }),
    );
    renderPreview();
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
  it('explains that no application exists when coverage is absent', async () => {
    mockAnalyze(
      await baseAnalysis({
        coverage: null,
        coverageSource: null,
        coverageContext: { captureState: 'no_application', parsingError: null },
      }),
    );
    renderPreview();
    fireEvent.click(
      screen.getByRole('button', { name: 'Analyze requirements' }),
    );
    expect(
      await screen.findByText(
        'No application has been submitted for this job, so no diagnostic coverage is available.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Diagnostic requirement coverage',
      }),
    ).not.toBeInTheDocument();
  });
  it('explains that the application included no resume snapshot', async () => {
    mockAnalyze(
      await baseAnalysis({
        coverage: null,
        coverageSource: null,
        coverageContext: { captureState: 'no_snapshot', parsingError: null },
      }),
    );
    renderPreview();
    fireEvent.click(
      screen.getByRole('button', { name: 'Analyze requirements' }),
    );
    expect(
      await screen.findByText(
        'The application did not include a resume snapshot, so no diagnostic coverage is available.',
      ),
    ).toBeInTheDocument();
  });
  it('explains that a failed snapshot yields no coverage claim', async () => {
    mockAnalyze(
      await baseAnalysis({
        coverage: null,
        coverageSource: null,
        coverageContext: {
          captureState: 'failed',
          parsingError: 'Unsupported resume format',
        },
      }),
    );
    renderPreview();
    fireEvent.click(
      screen.getByRole('button', { name: 'Analyze requirements' }),
    );
    expect(
      await screen.findByText(
        'The submitted resume snapshot could not be parsed. No claim of capability or possession is made.',
      ),
    ).toBeInTheDocument();
  });
  it('shows an abstention note when coverage exists but the snapshot failed to parse', async () => {
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
        parsingStatus: 'failed',
        parsingError: 'Unsupported resume format',
        normalizedText: null,
        skills: [],
        certifications: [],
      }),
    );
    expect(coverage.rows[0]?.status).toBe('UNKNOWN');
    mockAnalyze(
      await baseAnalysis({
        coverage,
        coverageSource: {
          snapshotId: 's1',
          parserVersion: 'resume-parser-v1',
          normalizationVersion: 'resume-normalization-v1',
        },
        coverageContext: {
          captureState: 'failed',
          parsingError: 'Unsupported resume format',
        },
      }),
    );
    renderPreview();
    fireEvent.click(
      screen.getByRole('button', { name: 'Analyze requirements' }),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Diagnostic requirement coverage',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/all coverage rows reflect parser abstention/),
    ).toBeInTheDocument();
  });
});
