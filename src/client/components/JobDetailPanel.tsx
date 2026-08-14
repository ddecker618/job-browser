import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import { api } from '../api.js';
import { AppliedCreationDialog } from './AppliedCreationDialog.js';
import { getFocusableElements } from './Dialog.js';
import { ErrorState, LoadingState } from './States.js';
import { invalidateScoreQueries } from '../scoreCache.js';
import type { RoleDetails } from '../../schemas/role-details.js';

function lifecycleDetailLabel(reason: string, userRemoved: boolean): string {
  if (userRemoved) return 'Removed from current';
  if (reason === 'closing-date-expired') return 'Expired after closing date';
  if (reason === 'provider-closed') return 'Closed by provider';
  if (reason === 'snapshot-missing') return 'No longer listed';
  return 'Inactive, reason unknown';
}

function eligibilityRejectionLabel(reason: string | null): string {
  switch (reason) {
    case 'clearance_required':
      return 'Active security clearance required; your profile does not evidence holding one. Update clearance eligibility to “eligible” if you hold one.';
    case 'professional_engineering_required':
      return 'Federal professional-engineering basic qualification (e.g. 0854, ABET) required; no engineering credential found in your profile.';
    case 'illinois_excluded':
      return 'Remote position explicitly excludes Illinois.';
    case 'location_outside_radius':
      return 'Location is outside your search radius.';
    case 'overnight_schedule':
      return 'Position requires a permanent overnight shift.';
    case 'rotating_nights':
      return 'Position requires rotating day/night shifts.';
    case 'weekend_coverage':
      return 'Position requires regular weekend coverage.';
    case 'sales_position':
      return 'Position is commission-based sales.';
    case 'field_installation':
      return 'Position has substantial physical or field-installation requirements.';
    case 'closed':
      return 'Posting is closed.';
    case 'already_applied':
      return 'You have already applied.';
    case 'dismissed':
      return 'Job was dismissed.';
    default:
      return reason ?? 'eligibility gate failed';
  }
}

export function JobDetailPanel({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId),
  });
  const [notes, setNotes] = useState('');
  const [showAppliedDialog, setShowAppliedDialog] = useState(false);
  useEffect(() => {
    if (job.data !== undefined) setNotes(job.data.notes ?? '');
  }, [job.data]);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected === true) previousFocus.focus();
    };
  }, []);
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
  const changeAvailability = useMutation({
    mutationFn: (action: 'remove' | 'restore' | 'verify') =>
      api.updateAvailability(jobId, action),
    onSuccess: invalidate,
  });
  const availabilityError = changeAvailability.error ?? null;

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !showAppliedDialog) {
          onClose();
        }
      }}
    >
      <aside
        ref={drawerRef}
        className="job-drawer"
        role="dialog"
        aria-label="Job details"
        aria-modal="true"
        aria-hidden={showAppliedDialog ? 'true' : undefined}
        inert={showAppliedDialog}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (showAppliedDialog) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = getFocusableElements(drawerRef.current);
          if (focusable.length === 0) {
            event.preventDefault();
            drawerRef.current?.focus();
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <button
          ref={closeButtonRef}
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
{job.data.active && job.data.status !== 'expired' ? null : (
                  <span className="removed">
                    {lifecycleDetailLabel(
                      job.data.lifecycleReason,
                      job.data.userRemoved,
                    )}
                  </span>
                )}
              </div>
            </div>
            {job.data.eligibilityPassed === false ? (
              <p className="eligibility-warning" role="alert">
                Ineligible:{' '}
                {eligibilityRejectionLabel(job.data.eligibilityRejection)}.
              </p>
            ) : null}
            <div className="action-strip">
              {job.data.existingApplicationId === null ? (
                <button onClick={() => setShowAppliedDialog(true)}>
                  Mark applied
                </button>
              ) : (
                <Link
                  className="button"
                  to={`/applications/${encodeURIComponent(
                    job.data.existingApplicationId,
                  )}`}
                >
                  View application
                </Link>
              )}
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
              {job.data.userRemoved ? (
                <button
                  onClick={() => changeAvailability.mutate('restore')}
                  disabled={changeAvailability.isPending}
                >
                  {changeAvailability.isPending ? 'Restoring…' : 'Restore'}
                </button>
              ) : (
                <button
                  onClick={() => changeAvailability.mutate('remove')}
                  disabled={changeAvailability.isPending}
                >
                  {changeAvailability.isPending ? 'Removing…' : 'Remove'}
                </button>
              )}
              <button
                onClick={() => changeAvailability.mutate('verify')}
                disabled={changeAvailability.isPending}
              >
                {changeAvailability.isPending ? 'Verifying…' : 'Verify'}
              </button>
            </div>
            {availabilityError === null ? null : (
              <p className="source-error" role="alert">
                {availabilityError.message}
              </p>
            )}
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
                  <dt>Work arrangement</dt>
                  <dd>
                    {job.data.roleDetails?.workplace.arrangement ??
                      job.data.workArrangement ??
                      job.data.remoteType}
                  </dd>
                </div>
                <div>
                  <dt>Posted</dt>
                  <dd>{formatDate(job.data.datePosted)}</dd>
                </div>
                <div>
                  <dt>Last verified</dt>
                  <dd>
                    {formatDate(job.data.lastVerifiedAt ?? job.data.lastSeenAt)}
                  </dd>
                </div>
                {job.data.removedAt == null ? null : (
                  <div>
                    <dt>Inactive since</dt>
                    <dd>{formatDate(job.data.removedAt)}</dd>
                  </div>
                )}
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
            <RoleDetailsSection roleDetails={job.data.roleDetails} />
            <section className="detail-section">
              <h3>Job notes</h3>
              <p>
                Notes about this retained Job. These are separate from
                Application summary notes and timeline Note events.
              </p>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add notes about this Job…"
              />
              <button
                className="button"
                onClick={() => update.mutate({ notes })}
              >
                Save Job notes
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
      {job.data === undefined || !showAppliedDialog ? null : (
        <AppliedCreationDialog
          job={job.data}
          onClose={() => setShowAppliedDialog(false)}
        />
      )}
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

function RoleDetailsSection({
  roleDetails,
}: {
  roleDetails: RoleDetails | null;
}): React.JSX.Element | null {
  if (roleDetails === null) return null;

  const rows: { label: string; value: string }[] = [];

  const workplaceLabel: Record<RoleDetails['workplace']['arrangement'], string> =
    {
      remote: 'Remote',
      hybrid: 'Hybrid',
      onsite: 'On-site',
      unknown: 'Unknown',
    };

  if (roleDetails.employment.type !== 'unknown') {
    const employmentLabel: Record<
      RoleDetails['employment']['type'],
      string
    > = {
      'full-time': 'Full-time',
      'part-time': 'Part-time',
      contract: 'Contract',
      temporary: 'Temporary',
      internship: 'Internship',
      unknown: 'Unknown',
    };
    rows.push({
      label: 'Employment',
      value: employmentLabel[roleDetails.employment.type],
    });
  }

  rows.push({
    label: 'Work arrangement',
    value: workplaceLabel[roleDetails.workplace.arrangement],
  });

  if (roleDetails.locations.primaryCity !== null) {
    rows.push({
      label: 'Primary location',
      value: [roleDetails.locations.primaryCity, roleDetails.locations.primaryState]
        .filter(Boolean)
        .join(', '),
    });
  }
  if (roleDetails.locations.remoteCapable) {
    rows.push({ label: 'Remote eligible', value: 'Yes' });
  }
  if (roleDetails.locations.multiple) {
    rows.push({ label: 'Multiple locations', value: 'Yes' });
  }

  if (roleDetails.clearance.mode !== 'unknown' && roleDetails.clearance.mode !== 'none') {
    rows.push({
      label: 'Clearance',
      value: [roleDetails.clearance.level, roleDetails.clearance.mode]
        .filter(Boolean)
        .join(' — '),
    });
  }
  if (roleDetails.clearance.sponsorable) {
    rows.push({ label: 'Clearance sponsorship', value: 'Available' });
  }

  if (roleDetails.education.degreeRequired !== 'none' && roleDetails.education.degreeRequired !== 'unknown') {
    const degreeLabel: Record<RoleDetails['education']['degreeRequired'], string> =
      {
        none: 'No degree required',
        associate: 'Associate degree',
        bachelor: "Bachelor's degree",
        master: "Master's degree",
        doctorate: 'Doctorate',
        unknown: 'Unknown',
      };
    rows.push({
      label: 'Education',
      value: degreeLabel[roleDetails.education.degreeRequired],
    });
  }
  if (roleDetails.education.degreeInProgressOk) {
    rows.push({ label: 'Degree in progress', value: 'Accepted' });
  }
  if (roleDetails.education.field !== null) {
    rows.push({ label: 'Degree field', value: roleDetails.education.field });
  }

  if (roleDetails.experience.requiredYears !== null) {
    rows.push({
      label: 'Experience required',
      value: `${String(roleDetails.experience.requiredYears)} years`,
    });
  }
  if (roleDetails.experience.preferredYears !== null) {
    rows.push({
      label: 'Experience preferred',
      value: `${String(roleDetails.experience.preferredYears)} years`,
    });
  }
  if (roleDetails.experience.substitution.length > 0) {
    rows.push({
      label: 'Experience substitution',
      value: roleDetails.experience.substitution.join('; '),
    });
  }

  if (roleDetails.skills.required.length > 0) {
    rows.push({ label: 'Required skills', value: roleDetails.skills.required.join(', ') });
  }
  if (roleDetails.skills.preferred.length > 0) {
    rows.push({
      label: 'Preferred skills',
      value: roleDetails.skills.preferred.join(', '),
    });
  }
  if (roleDetails.certifications.required.length > 0) {
    rows.push({
      label: 'Required certifications',
      value: roleDetails.certifications.required.join(', '),
    });
  }
  if (roleDetails.certifications.preferred.length > 0) {
    rows.push({
      label: 'Preferred certifications',
      value: roleDetails.certifications.preferred.join(', '),
    });
  }
  if (roleDetails.technologies.length > 0) {
    rows.push({
      label: 'Technologies',
      value: roleDetails.technologies.join(', '),
    });
  }
  if (roleDetails.occupationalSeries.length > 0) {
    rows.push({
      label: 'Occupational series',
      value: roleDetails.occupationalSeries.join(', '),
    });
  }
  if (roleDetails.citizenship.usCitizenRequired) {
    rows.push({ label: 'Citizenship', value: 'U.S. citizenship required' });
  }
  if (roleDetails.travel.required) {
    rows.push({
      label: 'Travel',
      value:
        roleDetails.travel.percent === null
          ? 'Required'
          : `Up to ${String(roleDetails.travel.percent)}%`,
    });
  }
  if (roleDetails.schedule.classification !== 'unknown') {
    rows.push({
      label: 'Schedule',
      value: [
        roleDetails.schedule.classification,
        ...roleDetails.schedule.flags,
      ].join(', '),
    });
  }

  const conditions: string[] = [];
  if (roleDetails.contingentConditions.commissionBased) conditions.push('Commission-based');
  if (roleDetails.contingentConditions.physicalRequirements) conditions.push('Physical requirements');
  if (roleDetails.contingentConditions.fieldInstallation) conditions.push('Field installation');
  if (roleDetails.contingentConditions.developmentFocused) conditions.push('Development-focused');
  if (roleDetails.contingentConditions.professionalEngineering)
    conditions.push('Professional engineering required');
  if (roleDetails.contingentConditions.contingentOnAward)
    conditions.push('Contingent on award');
  if (conditions.length > 0) {
    rows.push({ label: 'Conditions', value: conditions.join('; ') });
  }

  if (rows.length === 0) return null;

  return (
    <section className="detail-section">
      <h3>Structured role details</h3>
      <dl className="detail-list">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
