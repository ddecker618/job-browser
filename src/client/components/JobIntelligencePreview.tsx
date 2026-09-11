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
  return (
    <section className="job-intelligence-preview" aria-label="Job Intelligence">
      <h3>Job Intelligence</h3>
      <p>
        Analyze the full retained description locally. Experimental enrichment
        is not used for scoring.
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
      {analysis.data && (
        <div aria-live="polite">
          <p>
            {analysis.data.factCount} interpretations from{' '}
            {analysis.data.segmentCount} segments. Resume coverage unknown.
          </p>
          {analysis.data.facts.map((fact) => (
            <article key={fact.factId}>
              <strong>
                {fact.category} · {fact.strength}
              </strong>
              {fact.entities.map((entity) => (
                <p key={entity.id}>{entity.normalized}</p>
              ))}
              <blockquote>{fact.evidence.segmentText}</blockquote>
              <small>
                Source: {fact.evidence.sourceField}. {fact.reconciliation.note}
              </small>
            </article>
          ))}
        </div>
      )}
      <p>
        Shadow preview only. It does not change score, eligibility, ranking,
        filtering, lifecycle, or source job data.
      </p>
    </section>
  );
}
