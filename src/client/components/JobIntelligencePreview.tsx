import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { JobDetail } from '../../models/dashboard.js';
import { api, ApiRequestError } from '../api.js';

function capabilityDisabled(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && error.code === 'nlp_capability_disabled'
  );
}

export function JobIntelligencePreview({
  job,
}: {
  job: Pick<JobDetail, 'id'>;
}) {
  const client = useQueryClient();
  const existing = useQuery({
    queryKey: ['job-intelligence', job.id],
    queryFn: () => api.jobIntelligence(job.id),
    retry: false,
  });
  const analysis = useMutation({
    mutationFn: () => api.analyzeJobIntelligence(job.id),
    onSuccess: (data) =>
      client.setQueryData(['job-intelligence', job.id], data),
  });
  const projection = analysis.data ?? existing.data ?? null;
  const disabled =
    capabilityDisabled(existing.error) || capabilityDisabled(analysis.error);
  const failure = capabilityDisabled(analysis.error) ? null : analysis.error;
  const [resumeComparisonOpen, setResumeComparisonOpen] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const resumeOptions = useQuery({
    queryKey: ['resume-preview-options'],
    queryFn: api.resumePreviewOptions,
    enabled: resumeComparisonOpen && projection !== null && !disabled,
    retry: false,
  });
  const currentResumeComparison = useMutation({
    mutationFn: (resumeId: string) =>
      api.currentResumePreview(job.id, resumeId),
  });
  const currentResumePreview =
    currentResumeComparison.data?.resumeId === selectedResumeId
      ? currentResumeComparison.data
      : null;
  const selectedResumeName = resumeOptions.data?.find(
    (resume) => resume.id === selectedResumeId,
  )?.displayName;
  return (
    <section className="job-intelligence-preview" aria-label="Job Intelligence">
      <h3>Job Intelligence</h3>
      {disabled ? (
        <p role="status">
          Job Intelligence is disabled on this device, so these explanations are
          not available. Nothing about score, eligibility, ranking, filtering,
          lifecycle, or source job data is affected.
        </p>
      ) : (
        <>
          <p>
            App-generated explanations of the saved posting. Each claim shows
            its supporting text and is labeled as an interpretation (EXPLANATION
            level).
          </p>
          <button
            type="button"
            disabled={analysis.isPending}
            onClick={() => analysis.mutate()}
          >
            {analysis.isPending
              ? 'Analyzing requirements…'
              : projection
                ? 'Re-analyze requirements'
                : 'Analyze requirements'}
          </button>
          {failure && <p role="alert">{failure.message}</p>}
        </>
      )}
      {!disabled && projection && (
        <div aria-live="polite">
          <p>
            {projection.summary.factCount} requirement interpretation
            {projection.summary.factCount === 1 ? '' : 's'} from{' '}
            {projection.summary.segmentCount} segments.
            {projection.summary.conflictCount > 0
              ? ` ${String(projection.summary.conflictCount)} differ${
                  projection.summary.conflictCount === 1 ? 's' : ''
                } from the structured record.`
              : ''}
            {projection.summary.otherFactCount > 0
              ? ` ${String(projection.summary.otherFactCount)} non-requirement mention${
                  projection.summary.otherFactCount === 1 ? '' : 's'
                } noted.`
              : ''}
          </p>
          <p>
            Persisted shadow comparison:{' '}
            {
              projection.comparison.capabilities.filter(
                (item) => item.state === 'agreement',
              ).length
            }{' '}
            agreement,{' '}
            {
              projection.comparison.capabilities.filter(
                (item) => item.state === 'conflict',
              ).length
            }{' '}
            conflict. Structured values remain authoritative.
          </p>
          {projection.coverage === null ? (
            <p>
              {projection.coverageContext?.captureState === 'no_application'
                ? 'No application has been submitted for this job, so no diagnostic coverage is available.'
                : projection.coverageContext?.captureState === 'no_snapshot'
                  ? 'The application did not include a resume snapshot, so no diagnostic coverage is available.'
                  : projection.coverageContext?.captureState === 'failed'
                    ? 'The submitted resume snapshot could not be parsed. No claim of capability or possession is made.'
                    : 'No captured resume snapshot is available for diagnostic coverage.'}
            </p>
          ) : (
            <section
              className="job-intelligence-coverage"
              aria-label="Diagnostic requirement coverage"
            >
              <h4>Diagnostic requirement coverage</h4>
              {projection.coverageSource !== null && (
                <p>
                  Submitted resume snapshot evidence is the historical
                  application evidence shown by default.
                </p>
              )}
              {projection.coverageContext?.captureState === 'failed' && (
                <p className="job-intelligence-abstention-note">
                  The submitted resume snapshot could not be parsed; all
                  coverage rows reflect parser abstention, not evidence of
                  matched or missing capability.
                </p>
              )}
              <p>
                {Math.round(
                  projection.coverage.summary.weightedDiagnosticCoverage * 100,
                )}
                % evidence coverage across{' '}
                {projection.coverage.summary.totalRequirements} supported
                requirements. This ratio is diagnostic; it is not a job score
                and does not affect eligibility or ranking.
              </p>
              {projection.coverage.rows.map((row) => (
                <article
                  key={row.requirementId}
                  className="job-intelligence-coverage-row"
                >
                  <strong>
                    {row.status.replaceAll('_', ' ')} · {row.strength}
                  </strong>
                  <p>{row.phrase}</p>
                  {row.evidence
                    .filter(
                      (item) =>
                        item.relationship !== null &&
                        item.relationship !== 'UNRELATED',
                    )
                    .map((item) => (
                      <small key={item.evidenceId}>
                        Snapshot evidence: {item.rawLabel} · {item.provenance} ·
                        parser {item.parserVersion}
                      </small>
                    ))}
                </article>
              ))}
            </section>
          )}
          {projection.requirementFacts.map((fact) => (
            <article key={fact.factId} className="job-intelligence-fact">
              <strong>
                {fact.category} · {fact.strength}
              </strong>
              <p>{fact.interpretation}</p>
              {fact.confidenceBand && (
                <small>Confidence: {fact.confidenceBand}</small>
              )}
              {fact.entities.map((entity) => (
                <p key={entity.normalized + entity.type}>{entity.normalized}</p>
              ))}
              <blockquote>{fact.evidence.segmentText}</blockquote>
              <small>Source: {fact.evidence.sourceField}.</small>
              {fact.deterministic.state === 'conflict' && (
                <p className="job-intelligence-conflict" role="note">
                  Conflicts with the structured job record. The structured
                  record ({fact.deterministic.deterministicValue ?? 'set'}) is
                  authoritative.
                </p>
              )}
              {fact.deterministic.state === 'agreement' && (
                <small>Matches the structured job record.</small>
              )}
              {!fact.deterministic.available && (
                <small>Not reconciled with a structured field.</small>
              )}
            </article>
          ))}
          {projection.otherFacts.map((fact) => (
            <article key={fact.factId} className="job-intelligence-other">
              <small>
                {fact.category} · {fact.interpretation}
              </small>
            </article>
          ))}
          <p>
            These interpretations are produced by this app from the saved
            posting text. Nothing here asserts anything about you, and it does
            not change score, eligibility, ranking, filtering, lifecycle, or
            source job data.
          </p>
          <section
            className="job-intelligence-current-resume"
            aria-label="Current resume compatibility preview"
          >
            <h4>Current resume compatibility</h4>
            <p>
              Compare a saved resume with this job before creating an
              application. This is an explicit, local preview.
            </p>
            <button
              type="button"
              onClick={() => setResumeComparisonOpen((open) => !open)}
            >
              {resumeComparisonOpen
                ? 'Close resume comparison'
                : 'Compare with a saved resume'}
            </button>
            {resumeComparisonOpen && (
              <div className="job-intelligence-current-resume-controls">
                {resumeOptions.isLoading ? (
                  <p role="status">Loading saved resumes…</p>
                ) : resumeOptions.isError ? (
                  <p role="alert">Saved resumes are unavailable.</p>
                ) : resumeOptions.data === undefined ||
                  resumeOptions.data.length === 0 ? (
                  <p>No saved resumes are available to compare.</p>
                ) : (
                  <>
                    <label htmlFor="job-intelligence-current-resume">
                      Saved resume
                    </label>
                    <select
                      id="job-intelligence-current-resume"
                      value={selectedResumeId}
                      onChange={(event) => {
                        setSelectedResumeId(event.currentTarget.value);
                        currentResumeComparison.reset();
                      }}
                    >
                      <option value="">Choose a saved resume</option>
                      {resumeOptions.data.map((resume) => (
                        <option key={resume.id} value={resume.id}>
                          {resume.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={
                        selectedResumeId === '' ||
                        currentResumeComparison.isPending
                      }
                      onClick={() =>
                        currentResumeComparison.mutate(selectedResumeId)
                      }
                    >
                      {currentResumeComparison.isPending
                        ? 'Comparing resume…'
                        : 'Compare this resume'}
                    </button>
                  </>
                )}
                {currentResumeComparison.error && (
                  <p role="alert">
                    {currentResumeComparison.error instanceof ApiRequestError
                      ? currentResumeComparison.error.message
                      : 'The current resume preview is unavailable.'}
                  </p>
                )}
                {currentResumePreview && (
                  <div
                    className="job-intelligence-current-resume-result"
                    aria-live="polite"
                  >
                    <h5>Current resume preview</h5>
                    {selectedResumeName && <p>{selectedResumeName}</p>}
                    <p>This is evidence coverage, not a job score.</p>
                    <p>
                      It does not change eligibility, ranking, or your
                      application.
                    </p>
                    {currentResumePreview.captureState === 'failed' ||
                    currentResumePreview.coverage === null ? (
                      <p role="status">
                        This resume could not be parsed. No requirements are
                        reported as missing from this preview.
                      </p>
                    ) : (
                      <>
                        <p>
                          {Math.round(
                            currentResumePreview.coverage.summary
                              .weightedDiagnosticCoverage * 100,
                          )}
                          % evidence coverage across{' '}
                          {
                            currentResumePreview.coverage.summary
                              .totalRequirements
                          }{' '}
                          supported requirements.
                        </p>
                        {currentResumePreview.coverage.rows.map((row) => (
                          <article
                            key={row.requirementId}
                            className="job-intelligence-current-resume-row"
                          >
                            <strong>
                              {row.status.replaceAll('_', ' ')} · {row.strength}
                            </strong>
                            <p>{row.phrase}</p>
                            {row.evidence
                              .filter(
                                (item) =>
                                  item.relationship !== null &&
                                  item.relationship !== 'UNRELATED',
                              )
                              .map((item) => (
                                <small key={item.evidenceId}>
                                  Current resume evidence: {item.rawLabel} ·{' '}
                                  {item.provenance} · parser{' '}
                                  {item.parserVersion}
                                </small>
                              ))}
                          </article>
                        ))}
                        <small>
                          Source: current resume preview · parser{' '}
                          {currentResumePreview.parserVersion} · normalization{' '}
                          {currentResumePreview.normalizationVersion}
                        </small>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
