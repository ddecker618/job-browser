import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api.js';
import { ErrorState, LoadingState } from './States.js';
import { invalidateScoreQueries } from '../scoreCache.js';

export function JobDetailPanel({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId),
  });
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (job.data !== undefined) setNotes(job.data.notes ?? '');
  }, [job.data]);
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['job', jobId] }),
      client.invalidateQueries({ queryKey: ['source-control-center'] }),
      invalidateScoreQueries(client),
    ]);
  };
  const [statusError, setStatusError] = useState<string | null>(null);
  const updateStatus = useMutation({
    mutationFn: (status: string) => api.updateStatus(jobId, status),
  });
  const changeStatus = (status: string, closeAfter?: boolean) => {
    updateStatus.mutate(status, {
      onSuccess: () => {
        setStatusError(null);
        void invalidate();
        if (closeAfter) onClose();
      },
      onError: (error) => setStatusError(error.message),
    });
  };
  const update = useMutation({
    mutationFn: (body: { favorite?: boolean; notes?: string | null }) =>
      api.updateJob(jobId, body),
    onSuccess: invalidate,
  });
  const refresh = useMutation({
    mutationFn: () => api.refreshJob(jobId),
    onSuccess: invalidate,
  });

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="job-drawer" aria-label="Job details" aria-modal="true">
        <button
          className="icon-button drawer-close"
          onClick={onClose}
          aria-label="Close job details"
        >
          ×
        </button>
        {job.isPending ? (
          <LoadingState label="Loading job details" />
        ) : job.isError ? (
          <ErrorState error={job.error} />
        ) : (
          <>
            <div className="job-detail-heading">
              <span className="eyebrow">{job.data.provider}</span>
              <h2>{job.data.title}</h2>
              <p>
                {job.data.company} ·{' '}
                {job.data.location ?? 'Location not listed'}
              </p>
              <div className="detail-badges">
                <span className="score-badge">
                  {job.data.score?.toFixed(1) ?? '—'} score
                </span>
                <span className="recommendation-badge">
                  {job.data.recommendation ?? 'Unscored'}
                </span>
                <span>{job.data.workArrangement ?? job.data.remoteType}</span>
                <span>{job.data.status}</span>
              </div>
            </div>
            {job.data.eligibilityPassed === false ? (
              <p className="eligibility-warning" role="alert">
                Ineligible:{' '}
                {job.data.eligibilityRejection ?? 'eligibility gate failed'}.
              </p>
            ) : null}
            <div className="action-strip">
              <button
                onClick={() => changeStatus('applied')}
                disabled={updateStatus.isPending}
              >
                {updateStatus.isPending && updateStatus.variables === 'applied'
                  ? 'Applying…'
                  : 'Mark applied'}
              </button>
              <button
                onClick={() => changeStatus('ignored', true)}
                disabled={updateStatus.isPending}
              >
                {updateStatus.isPending && updateStatus.variables === 'ignored'
                  ? 'Hiding…'
                  : 'Hide'}
              </button>
              <button
                aria-label="Favorite job"
                onClick={() => update.mutate({ favorite: !job.data.favorite })}
              >
                {job.data.favorite ? '★ Favorited' : '☆ Favorite'}
              </button>
              <button
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
              >
                {refresh.isPending ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {statusError === null ? null : (
              <p className="source-error" role="alert">
                {statusError}
              </p>
            )}
            <section className="detail-section">
              <h3>Match breakdown</h3>
              {job.data.categoryScores === null ? (
                <p>Run analysis to create category scores.</p>
              ) : (
                <div className="category-scores">
                  {Object.entries(job.data.categoryScores).map(
                    ([name, value]) => (
                      <div key={name}>
                        <span>{formatLabel(name)}</span>
                        <div className="score-track">
                          <i style={{ width: `${String(value)}%` }} />
                        </div>
                        <strong>{value.toFixed(0)}</strong>
                      </div>
                    ),
                  )}
                </div>
              )}
            </section>
            <section className="detail-columns">
              <div className="detail-section">
                <h3>Why it matches</h3>
                <ul>
                  {job.data.explanations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="detail-section warning-list">
                <h3>Missing qualifications</h3>
                {job.data.missingQualifications.length === 0 ? (
                  <p>None identified.</p>
                ) : (
                  <ul>
                    {job.data.missingQualifications.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            <section className="detail-section">
              <h3>Required capabilities</h3>
              <div className="tag-list">
                {[...job.data.skills, ...job.data.certifications].map(
                  (item) => (
                    <span key={item}>{item}</span>
                  ),
                )}
              </div>
            </section>
            <section className="detail-section">
              <h3>Role details</h3>
              <dl className="detail-list">
                <div>
                  <dt>Salary</dt>
                  <dd>
                    {job.data.salaryText ??
                      formatSalary(
                        job.data.salaryMinimum,
                        job.data.salaryMaximum,
                      )}
                  </dd>
                </div>
                <div>
                  <dt>Employment</dt>
                  <dd>{job.data.employmentType}</dd>
                </div>
                <div>
                  <dt>Posted</dt>
                  <dd>{formatDate(job.data.datePosted)}</dd>
                </div>
                <div>
                  <dt>Last verified</dt>
                  <dd>{formatDate(job.data.lastSeenAt)}</dd>
                </div>
                <div>
                  <dt>Clearance</dt>
                  <dd>{job.data.clearanceRequirement ?? 'Not listed'}</dd>
                </div>
                {job.data.agency === null ? null : (
                  <div>
                    <dt>Agency</dt>
                    <dd>{job.data.agency}</dd>
                  </div>
                )}
                {job.data.gradeLow === null &&
                job.data.gradeHigh === null ? null : (
                  <div>
                    <dt>Grade</dt>
                    <dd>
                      {[
                        job.data.payPlan,
                        job.data.gradeLow === job.data.gradeHigh
                          ? job.data.gradeLow
                          : `${job.data.gradeLow ?? '?'}–${job.data.gradeHigh ?? '?'}`,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    </dd>
                  </div>
                )}
                {job.data.appointmentType === null ? null : (
                  <div>
                    <dt>Appointment</dt>
                    <dd>{job.data.appointmentType}</dd>
                  </div>
                )}
                {job.data.workSchedule === null ? null : (
                  <div>
                    <dt>Schedule</dt>
                    <dd>{job.data.workSchedule}</dd>
                  </div>
                )}
                {job.data.closingDate === null ? null : (
                  <div>
                    <dt>Closes</dt>
                    <dd>{formatDate(job.data.closingDate)}</dd>
                  </div>
                )}
              </dl>
              <p className="description-text">
                {job.data.description ?? 'No description provided.'}
              </p>
            </section>
            <section className="detail-section">
              <h3>Notes</h3>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add application notes…"
              />
              <button
                className="button"
                onClick={() => update.mutate({ notes })}
              >
                Save notes
              </button>
            </section>
            <section className="detail-section">
              <h3>Links and sources</h3>
              <div className="link-actions">
                {job.data.postingUrl === null ? null : (
                  <>
                    <a
                      className="button"
                      href={job.data.postingUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open employer posting
                    </a>
                    <button
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          job.data.postingUrl ?? '',
                        )
                      }
                    >
                      Copy employer URL
                    </button>
                  </>
                )}
                {job.data.sources.map((source, index) =>
                  source.postingUrl === null ? null : (
                    <div key={`${source.postingUrl}-${String(index)}`}>
                      <a
                        href={source.postingUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open {source.providerId ?? 'source'}
                      </a>
                      <button
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            source.postingUrl ?? '',
                          )
                        }
                      >
                        Copy discovery URL
                      </button>
                    </div>
                  ),
                )}
                {job.data.applicationUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    Open application page
                  </a>
                ))}
              </div>
              {refresh.isError ? (
                <p className="source-error" role="alert">
                  {refresh.error.message}
                </p>
              ) : null}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

function formatLabel(value: string): string {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (letter) => letter.toUpperCase());
}
function formatDate(value: string | null): string {
  return value === null
    ? 'Not listed'
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
        new Date(value),
      );
}
function formatSalary(minimum: number | null, maximum: number | null): string {
  if (minimum === null && maximum === null) return 'Not listed';
  return [minimum, maximum]
    .filter((value) => value !== null)
    .map((value) => `$${value.toLocaleString()}`)
    .join(' – ');
}
