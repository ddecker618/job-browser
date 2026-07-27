import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings } from '../../models/dashboard.js';
import { api } from '../api.js';
import { PageHeader } from '../components/PageHeader.js';
import { ErrorState, LoadingState } from '../components/States.js';
import { DesktopSettings } from '../components/DesktopSettings.js';

export function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const discovery = useQuery({
    queryKey: ['source-control-center'],
    queryFn: api.sourceControlCenter,
  });
  const client = useQueryClient();
  const form = useForm<AppSettings>();
  useEffect(() => {
    if (settings.data !== undefined) form.reset(settings.data);
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (value) => {
      document.documentElement.dataset['theme'] = value.theme;
      localStorage.setItem('job-browser-theme', value.theme);
      return client.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const saveAutomation = useMutation({
    mutationFn: api.saveDiscoverySettings,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['source-control-center'] }),
  });
  if (settings.isPending) return <LoadingState label="Loading settings" />;
  if (settings.isError)
    return <ErrorState error={settings.error} title="Settings unavailable" />;
  return (
    <>
      <PageHeader
        eyebrow="Local application"
        title="Settings"
        description="Configure storage, search defaults, appearance, and diagnostics. Database path changes apply after restart."
      />
      <form
        className="settings-form"
        onSubmit={(event) =>
          void form.handleSubmit((values) => save.mutate(values))(event)
        }
      >
        <section className="form-panel">
          <div className="section-heading">
            <span>01</span>
            <div>
              <h3>Storage</h3>
              <p>Local directories used by Job Browser.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="span-2">
              Database location
              <input {...form.register('databaseLocation')} />
            </label>
            <label className="span-2">
              Resume directory
              <input {...form.register('resumeDirectory')} />
            </label>
            <label className="span-2">
              Artifact directory
              <input {...form.register('artifactDirectory')} />
            </label>
          </div>
        </section>
        <section className="form-panel">
          <div className="section-heading">
            <span>02</span>
            <div>
              <h3>Experience</h3>
              <p>Default dashboard and discovery behavior.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="span-2">
              Default search
              <input {...form.register('defaultSearch')} />
            </label>
            <label>
              Theme
              <select {...form.register('theme')}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label>
              Default sort
              <select {...form.register('defaultSort')}>
                <option value="score">Highest score</option>
                <option value="newest">Newest</option>
                <option value="company">Company</option>
              </select>
            </label>
            <label>
              Logging level
              <select {...form.register('loggingLevel')}>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            </label>
          </div>
        </section>
        <DesktopSettings />
        <section className="form-panel">
          <div className="section-heading">
            <span>04</span>
            <div>
              <h3>Discovery automation</h3>
              <p>
                Scheduled sources run only while the desktop application is
                open. Missed runs are not started automatically.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="checkbox-field span-2">
              <input
                type="checkbox"
                checked={discovery.data?.schedulerEnabled ?? false}
                disabled={discovery.isPending || saveAutomation.isPending}
                onChange={(event) =>
                  saveAutomation.mutate(event.target.checked)
                }
              />
              Allow enabled source schedules while Job Browser is open
            </label>
          </div>
        </section>
        <div className="sticky-form-actions">
          <span>
            {save.isSuccess
              ? 'Settings saved.'
              : discovery.data?.schedulerEnabled === true
                ? 'Scheduled discovery is enabled.'
                : 'Scheduled discovery is off.'}
          </span>
          <button className="button primary" type="submit">
            Save settings
          </button>
        </div>
      </form>
    </>
  );
}
