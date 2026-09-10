// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { JobIntelligencePreview } from '../src/client/components/JobIntelligencePreview.js';

afterEach(() => cleanup());

describe('Job Intelligence preview (Stage 26)', () => {
  it('summarizes job requirements and keeps disconnected coverage unknown', () => {
    render(
      <JobIntelligencePreview
        job={{
          requirements: '- Python required\n- Security+ certification',
          preferredQualifications: 'Kubernetes preferred.',
          skills: ['Python'],
          certifications: ['Security+'],
        }}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Job Intelligence' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Python required')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes preferred')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown')).toHaveLength(5);
    expect(screen.getAllByText(/Interpreted as:/)).toHaveLength(5);
    expect(
      screen.getByText(/Resume evidence is not connected/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not change score, eligibility, ranking/),
    ).toBeInTheDocument();
  });

  it('renders a neutral empty state without inventing evidence', () => {
    render(
      <JobIntelligencePreview
        job={{
          requirements: null,
          preferredQualifications: null,
          skills: [],
          certifications: [],
        }}
      />,
    );

    expect(
      screen.getByText(/No requirement text or capability mentions/),
    ).toBeInTheDocument();
    expect(screen.getByText('Coverage unknown')).toBeInTheDocument();
  });
});
