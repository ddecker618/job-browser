import type { DiscoveryRunView } from '../../models/source-management.js';

export function DiscoveryRunPanel({ runs }: { runs: DiscoveryRunView[] }) {
  return (
    <section className="run-panel">
      <div className="section-heading">
        <span>R</span>
        <div>
          <h3>Recent discovery</h3>
          <p>Latest source activity and counts.</p>
        </div>
      </div>
      {runs.length === 0 ? (
        <p>No discovery runs yet.</p>
      ) : (
        <div className="run-list">
          {runs.map((run) => (
            <div key={run.id} className="run-row">
              <span
                className={`health-badge ${run.status === 'succeeded' ? 'healthy' : run.status}`}
              >
                {run.status}
              </span>
              <strong>{run.providerId ?? 'manual'}</strong>
              <span>{new Date(run.startedAt).toLocaleString()}</span>
              <span>
                {run.jobsInserted} new · {run.duplicatesMerged} merged
              </span>
              {run.error === null ? null : (
                <span className="source-error">{run.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
