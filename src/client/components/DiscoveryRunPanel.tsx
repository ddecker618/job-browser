import type { DiscoveryRunView } from '../../models/source-management.js';

function isSignInError(message: string): boolean {
  return (
    message.startsWith('Verification required') ||
    message.startsWith('Authentication required')
  );
}

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
                <span
                  className={
                    run.status === 'interrupted'
                      ? 'source-note'
                      : isSignInError(run.error)
                        ? 'source-note-strong'
                        : 'source-error'
                  }
                >
                  {run.error}
                  {isSignInError(run.error)
                    ? ' — complete sign-in in the browser window, then run again.'
                    : null}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
