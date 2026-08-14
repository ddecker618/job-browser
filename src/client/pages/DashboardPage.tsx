import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { api } from '../api.js';
import { ErrorState, LoadingState } from '../components/States.js';
import { PageHeader } from '../components/PageHeader.js';

export function DashboardPage() {
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  if (summary.isPending) return <LoadingState label="Building your overview" />;
  if (summary.isError)
    return <ErrorState error={summary.error} title="Dashboard unavailable" />;

  const cards = [
    ['Total jobs', summary.data.totalJobs, 'All discovered opportunities'],
    ['New today', summary.data.newJobsToday, 'Freshly discovered'],
    ['Strong matches', summary.data.strongMatches, 'Apply first'],
    ['Verified matches', summary.data.verifiedMatches, 'Eligibility confirmed'],
    ['Applied', summary.data.appliedJobs, 'Application history'],
    ['Hidden', summary.data.hiddenJobs, 'Removed from focus'],
    ['Expired', summary.data.expiredJobs, 'No longer active'],
    ['Removed', summary.data.userRemovedJobs, 'Manually removed from Current'],
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow="Daily brief"
        title="Opportunity command center"
        description="Prioritize the strongest roles, monitor applications, and spot market signals."
        actions={
          <Link className="button primary" to="/jobs">
            Review jobs
          </Link>
        }
      />
      <section className="summary-grid" aria-label="Job summary">
        {cards.map(([label, value, detail], index) => (
          <article
            className={`summary-card accent-${String(index % 3)}`}
            key={label}
          >
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>
      <section className="dashboard-grid">
        <article className="panel score-panel">
          <div>
            <span className="eyebrow">Match health</span>
            <h3>Average match score</h3>
          </div>
          <div
            className="score-orbit"
            aria-label={`${summary.data.averageMatchScore.toFixed(1)} average match score`}
          >
            <strong>{summary.data.averageMatchScore.toFixed(1)}</strong>
            <span>/ 100</span>
          </div>
          <p>Current weighted average across scored jobs.</p>
        </article>
        <article className="panel signal-panel">
          <span className="eyebrow">Market signals</span>
          <h3>Where demand is clustering</h3>
          <dl>
            <div>
              <dt>Top employer</dt>
              <dd>{summary.data.topEmployer ?? 'Not enough data'}</dd>
            </div>
            <div>
              <dt>Top requested skill</dt>
              <dd>{summary.data.topSkill ?? 'Not enough data'}</dd>
            </div>
          </dl>
          <Link to="/analytics">Explore analytics →</Link>
        </article>
        <article className="panel activity-panel">
          <span className="eyebrow">Recent activity</span>
          <h3>Latest changes</h3>
          {summary.data.recentActivity.length === 0 ? (
            <p>No recent activity.</p>
          ) : (
            <ol className="activity-list">
              {summary.data.recentActivity.map((item) => (
                <li key={item.id}>
                  <span className={`activity-icon ${item.type}`} />{' '}
                  <div>
                    <strong>{item.label}</strong>
                    <time>{formatRelative(item.timestamp)}</time>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>
    </>
  );
}

function formatRelative(value: string): string {
  const difference = Date.now() - Date.parse(value);
  const hours = Math.max(0, Math.floor(difference / 3_600_000));
  if (hours < 1) return 'Less than an hour ago';
  if (hours < 24) return `${String(hours)} hours ago`;
  return `${String(Math.floor(hours / 24))} days ago`;
}
