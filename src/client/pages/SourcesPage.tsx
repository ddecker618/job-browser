import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  ConfiguredSource,
  SourceInput,
} from '../../models/source-management.js';
import { api } from '../api.js';
import { DiscoveryRunPanel } from '../components/DiscoveryRunPanel.js';
import { PageHeader } from '../components/PageHeader.js';
import { SourceEditor } from '../components/SourceEditor.js';
import { EmptyState, ErrorState, LoadingState } from '../components/States.js';

export function SourcesPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<ConfiguredSource | 'new' | null>(null);
  const [deletingSource, setDeletingSource] = useState<ConfiguredSource | null>(
    null,
  );
  const control = useQuery({
    queryKey: ['source-control-center'],
    queryFn: api.sourceControlCenter,
    refetchInterval: (query) =>
      query.state.data?.discovery?.running === true ? 1500 : 30_000,
  });
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: api.providers,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['source-control-center'] });
  };
  const runSource = useMutation({
    mutationFn: api.runSource,
    onSettled: refresh,
  });
  const runAll = useMutation({
    mutationFn: api.runAllSources,
    onSettled: refresh,
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setSourceEnabled(id, enabled),
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: api.deleteSource,
    onSuccess: () => {
      setDeletingSource(null);
      refresh();
    },
  });
  const health = useMutation({
    mutationFn: api.validateSourceHealth,
    onSettled: refresh,
  });
  if (control.isPending || providers.isPending)
    return <LoadingState label="Loading discovery sources" />;
  if (control.isError)
    return (
      <ErrorState error={control.error} title="Source control unavailable" />
    );
  if (providers.isError)
    return (
      <ErrorState
        error={providers.error}
        title="Provider catalog unavailable"
      />
    );
  const save = async (input: SourceInput) => {
    if (editing === 'new') await api.createSource(input);
    else if (editing !== null) await api.updateSource(editing.id, input);
    setEditing(null);
    refresh();
  };
  const summary = control.data.summary;
  return (
    <>
      <PageHeader
        eyebrow="Discovery control"
        title="Sources"
        description="Manage public job sources, schedules, health, and multi-source discovery."
      />
      <section className="source-summary" aria-label="Discovery summary">
        <Metric label="Healthy" value={summary.healthySources} />
        <Metric label="Enabled" value={summary.enabledSources} />
        <Metric label="Disabled" value={summary.disabledSources} />
        <Metric label="Failed" value={summary.failedSources} />
        <Metric label="Found today" value={summary.jobsFoundToday} />
        <Metric label="New unique" value={summary.newUniqueJobs} />
        <Metric label="Merged" value={summary.duplicatesMerged} />
        <Metric
          label="Next run"
          value={formatDate(summary.nextScheduledRun, true)}
        />
      </section>
      <div className="source-toolbar">
        <button
          className="button primary"
          type="button"
          onClick={() => setEditing('new')}
        >
          Add source
        </button>
        <button
          type="button"
          onClick={() => runAll.mutate()}
          disabled={
            runAll.isPending || control.data.discovery?.running === true
          }
        >
          Run all enabled
        </button>
        <span role="status">
          {control.data.discovery?.running === true
            ? `Running ${control.data.discovery.activeSourceId ?? 'discovery'} · ${String(control.data.discovery.completedSources)}/${String(control.data.discovery.totalSources)}`
            : `Last run ${formatDate(summary.lastDiscoveryRun)}`}
        </span>
      </div>
      {editing === null ? null : (
        <SourceEditor
          providers={providers.data}
          {...(editing === 'new' ? {} : { source: editing })}
          onValidate={api.validateSource}
          onDetect={api.detectSource}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {control.data.sources.length === 0 ? (
        <EmptyState title="No configured sources">
          Add a supported public source to begin discovery.
        </EmptyState>
      ) : (
        <div className="source-list">
          {control.data.sources.map((source) => (
            <article key={source.id} className="source-card">
              <div className="source-logo">
                {source.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h3>{source.displayName}</h3>
                <p>
                  {source.providerId ?? source.sourceType} · {source.employer}
                </p>
              </div>
              <span className={`health-badge ${source.healthStatus}`}>
                <i />
                {source.healthStatus}
              </span>
              <label className="source-toggle">
                <input
                  type="checkbox"
                  checked={source.enabled}
                  onChange={(event) =>
                    toggle.mutate({
                      id: source.id,
                      enabled: event.target.checked,
                    })
                  }
                />{' '}
                Enabled
              </label>
              <dl>
                <div>
                  <dt>Last success</dt>
                  <dd>{formatDate(source.lastSuccessfulRun)}</dd>
                </div>
                <div>
                  <dt>Next run</dt>
                  <dd>{formatDate(source.schedule.nextRunAt)}</dd>
                </div>
                <div>
                  <dt>Schedule</dt>
                  <dd>
                    {source.schedule.enabled
                      ? formatCadence(source.schedule.cadence)
                      : 'Manual'}
                  </dd>
                </div>
                <div>
                  <dt>Configuration</dt>
                  <dd>{source.configurationStatus}</dd>
                </div>
              </dl>
              {source.healthMessage === null ? null : (
                <p
                  className={
                    source.healthStatus === 'failed' ? 'source-error' : ''
                  }
                >
                  {source.healthMessage}
                </p>
              )}
              <div className="card-actions">
                <button type="button" onClick={() => setEditing(source)}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => health.mutate(source.id)}
                  disabled={health.isPending}
                >
                  Validate
                </button>
                <button
                  type="button"
                  onClick={() => runSource.mutate(source.id)}
                  disabled={!source.enabled || runSource.isPending}
                >
                  Run source
                </button>
                <button
                  type="button"
                  className="button danger"
                  onClick={() => setDeletingSource(source)}
                >
                  Delete
                </button>
                {source.careersUrl === null ? null : (
                  <a className="button" href={source.careersUrl}>
                    Careers page
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <DiscoveryRunPanel runs={control.data.recentRuns} />
      {deletingSource && (
        <div className="modal-overlay" onClick={() => setDeletingSource(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Source</h3>
            <p>
              Are you sure you want to delete the source{' '}
              <strong>{deletingSource.displayName}</strong>? This will
              permanently delete this source, its schedule, and all job
              associations/observations. Jobs with active applications will not
              be deleted from your database.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setDeletingSource(null)}>
                Cancel
              </button>
              {deletingSource.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    toggle.mutate({ id: deletingSource.id, enabled: false });
                    setDeletingSource(null);
                  }}
                >
                  Disable instead
                </button>
              )}
              <button
                type="button"
                className="button danger"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  deleteMutation.mutate(deletingSource.id);
                }}
              >
                {deleteMutation.isPending
                  ? 'Deleting...'
                  : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="source-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function formatDate(value: string | null, compact = false) {
  if (value === null) return 'Never';
  const date = new Date(value);
  return compact
    ? date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : date.toLocaleString();
}
function formatCadence(cadence: string): string {
  switch (cadence) {
    case 'manual':
      return 'Manual';
    case 'every-6-hours':
      return 'Every 6 hours';
    case 'every-12-hours':
      return 'Every 12 hours';
    case 'every-24-hours':
      return 'Every 24 hours';
    case 'daily':
      return 'Daily';
    default:
      return cadence.charAt(0).toUpperCase() + cadence.slice(1);
  }
}
