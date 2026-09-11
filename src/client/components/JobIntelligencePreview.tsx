import { useMutation } from '@tanstack/react-query';
import type { JobDetail } from '../../models/dashboard.js';
import { api } from '../api.js';

export function JobIntelligencePreview({
  job,
}: {
  job: Pick<JobDetail, 'id'>;
}) {
  const analysis = useMutation({
    mutationFn: () => api.analyzeJobIntelligence(job.id),
  });
  const projection = analysis.data;
  return (
    <section className="job-intelligence-preview" aria-label="Job Intelligence">
      <h3>Job Intelligence</h3>
      <p>
        App-generated explanations of the saved posting. Each claim shows its
        supporting text and is labeled as an interpretation (EXPLANATION level).
      </p>
      <button
        type="button"
        disabled={analysis.isPending}
        onClick={() => analysis.mutate()}
      >
        {analysis.isPending
          ? 'Analyzing requirements…'
          : 'Analyze requirements'}
      </button>
      {analysis.error && <p role="alert">{analysis.error.message}</p>}
      {projection && (
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
              No captured resume snapshot is available for diagnostic coverage.
            </p>
          ) : (
            <section
              className="job-intelligence-coverage"
              aria-label="Diagnostic requirement coverage"
            >
              <h4>Diagnostic requirement coverage</h4>
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
        </div>
      )}
    </section>
  );
}
