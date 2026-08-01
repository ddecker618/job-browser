import { useState } from 'react';

import type {
  AtsDetectionResult,
  ConfiguredSource,
  ProviderConfiguration,
  ProviderDescriptor,
  SourceInput,
  ValidationResult,
} from '../../models/source-management.js';

interface SourceEditorProps {
  providers: ProviderDescriptor[];
  source?: ConfiguredSource;
  onSave: (input: SourceInput) => Promise<void>;
  onValidate: (
    providerId: string,
    configuration: ProviderConfiguration,
  ) => Promise<ValidationResult>;
  onDetect: (url: string) => Promise<AtsDetectionResult>;
  onCancel: () => void;
}

export function SourceEditor({
  providers,
  source,
  onSave,
  onValidate,
  onDetect,
  onCancel,
}: SourceEditorProps) {
  const [providerId, setProviderId] = useState(
    source?.providerId ?? providers[0]?.id ?? 'smartrecruiters',
  );
  const [displayName, setDisplayName] = useState(source?.displayName ?? '');
  const [employer, setEmployer] = useState(source?.employer ?? '');
  const [careersUrl, setCareersUrl] = useState(source?.careersUrl ?? '');
  const [query, setQuery] = useState(
    source?.searchCriteria.query ?? 'security',
  );
  const [location, setLocation] = useState(
    source?.searchCriteria.location ?? '',
  );
  const [remoteOnly, setRemoteOnly] = useState(
    source?.searchCriteria.remoteOnly ?? false,
  );
  const [limit, setLimit] = useState(source?.searchCriteria.limit ?? 50);
  const [configuration, setConfiguration] = useState<Record<string, unknown>>(
    source?.configuration ?? {},
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(
    source?.schedule.enabled ?? false,
  );
  const [cadence, setCadence] = useState<SourceInput['schedule']['cadence']>(
    source?.schedule.cadence ?? 'manual',
  );
  const [dailyLocalTime, setDailyLocalTime] = useState(
    source?.schedule.dailyLocalTime ?? '09:00',
  );
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [detection, setDetection] = useState<AtsDetectionResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const updateConfiguration = (key: string, value: unknown) => {
    setConfiguration((current) => ({ ...current, [key]: value }));
    setValidation(null);
  };
  const validate = async () => {
    setBusy(true);
    try {
      const derived = configurationFor(
        providerId,
        configuration,
        careersUrl,
        employer,
      );
      const guidance = missingConfigGuidance(providerId, derived);
      if (guidance !== null) {
        setValidation(null);
        setMessage(guidance);
        return;
      }
      const result = await onValidate(providerId, derived);
      setValidation(result);
      if (!result.valid) {
        if (result.failureCategory === 'legacy_portal') {
          setMessage(
            'iCIMS detected, but this portal format is not supported.',
          );
        } else if (
          result.failureCategory === 'endpoint_not_found' ||
          result.failureCategory === 'unsupported_variant' ||
          result.failureCategory === 'invalid_response'
        ) {
          setMessage(
            'The careers site was reached, but the expected job data format was not found.',
          );
        } else {
          setMessage(result.message);
        }
      } else {
        const sampleMsg =
          result.diagnostics?.sampleCount !== undefined
            ? ` (${String(result.diagnostics.sampleCount)} jobs detected)`
            : '';
        const variantLabel =
          result.variant === 'jibe_json'
            ? 'Jibe JSON API'
            : result.variant === 'icims_hosted_v2'
              ? 'Hosted v2 JSON'
              : result.variant === 'icims_hosted_v1'
                ? 'Hosted v1 Web'
                : 'Unknown format';
        setMessage(
          `Validation succeeded (${variantLabel}). Resolved iCIMS portal: ${result.diagnostics?.resolvedPortalUrl ?? ''}${sampleMsg}. Source is ready to save.`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const detect = async () => {
    setBusy(true);
    try {
      const result = await onDetect(careersUrl.trim());
      setDetection(result);
      setMessage(result.explanation);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const applyDetection = () => {
    if (detection?.suggestedProvider === null || detection === null) return;
    const suggestedConfiguration =
      detection.extractedConfiguration ?? detection.fallbackConfiguration;
    setProviderId(detection.suggestedProvider);
    setConfiguration(suggestedConfiguration ?? {});
    setCareersUrl(detection.resolvedUrl);

    const detectedCompany = suggestedConfiguration
      ? (suggestedConfiguration['company'] ?? '')
      : '';
    if (typeof detectedCompany === 'string' && detectedCompany.trim()) {
      if (!employer.trim()) {
        setEmployer(detectedCompany);
      }
      if (!displayName.trim()) {
        setDisplayName(detectedCompany);
      }
    }
    setValidation(null);
    setMessage(
      'Detected configuration applied. Validate the source before saving.',
    );
  };
  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        displayName: displayName.trim() || employer.trim() || providerId,
        employer: employer.trim() || displayName.trim() || providerId,
        providerId,
        careersUrl: careersUrl.trim() || null,
        configuration: configurationFor(
          providerId,
          configuration,
          careersUrl,
          employer,
        ),
        searchCriteria: {
          query: query.trim(),
          location: location.trim() || null,
          remoteOnly,
          limit,
        },
        enabled: source?.enabled ?? false,
        schedule: {
          enabled: scheduleEnabled,
          cadence,
          dailyLocalTime: cadence === 'daily' ? dailyLocalTime : null,
        },
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="form-panel source-editor" aria-label="Source editor">
      <div className="section-heading">
        <span>+</span>
        <div>
          <h3>{source === undefined ? 'Add source' : 'Edit source'}</h3>
          <p>Connect a supported public job source.</p>
        </div>
      </div>
      <div className="form-grid">
        <label>
          Provider
          <select
            value={providerId}
            onChange={(event) => {
              setProviderId(event.target.value);
              setConfiguration({});
              setValidation(null);
            }}
            disabled={source !== undefined}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Display name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          Employer
          <input
            value={employer}
            onChange={(event) => {
              setEmployer(event.target.value);
              setValidation(null);
            }}
          />
        </label>
        <label className="span-2">
          Public careers URL
          <input
            type="url"
            value={careersUrl}
            placeholder="https://careers.example.com"
            onChange={(event) => {
              setCareersUrl(event.target.value);
              setValidation(null);
            }}
          />
        </label>
        <span className="field-note span-2">
          Enter the employer’s public careers page. It is used to detect the
          ATS and auto-fill the source configuration.
        </span>
        {source === undefined ? (
          <div className="card-actions span-2">
            <button
              type="button"
              onClick={() => void detect()}
              disabled={busy || careersUrl.trim() === ''}
            >
              Detect ATS
            </button>
          </div>
        ) : null}
        <ProviderFields
          providerId={providerId}
          configuration={configuration}
          update={updateConfiguration}
        />
        <label>
          Keywords
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Location
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        <label>
          Maximum jobs
          <input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={remoteOnly}
            onChange={(event) => setRemoteOnly(event.target.checked)}
          />{' '}
          Remote only
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={(event) => {
              setScheduleEnabled(event.target.checked);
              if (event.target.checked && cadence === 'manual') {
                setCadence('daily');
              } else if (!event.target.checked) {
                setCadence('manual');
              }
            }}
          />{' '}
          Scheduled discovery
        </label>
        <label>
          Cadence
          <select
            value={cadence}
            onChange={(event) => {
              const val = event.target
                .value as SourceInput['schedule']['cadence'];
              setCadence(val);
              if (val === 'manual') {
                setScheduleEnabled(false);
              } else {
                setScheduleEnabled(true);
              }
            }}
          >
            <option value="manual">Manual</option>
            <option value="every-6-hours">Every 6 hours</option>
            <option value="every-12-hours">Every 12 hours</option>
            <option value="every-24-hours">Every 24 hours</option>
            <option value="daily">Daily</option>
          </select>
        </label>
        {cadence === 'daily' ? (
          <label>
            Local run time
            <input
              type="time"
              value={dailyLocalTime}
              onChange={(event) => setDailyLocalTime(event.target.value)}
            />
          </label>
        ) : null}
      </div>
      {detection === null ? null : (
        <div className="source-preview" aria-label="ATS detection result">
          <strong>
            {detection.detectedPlatform
              ? detection.failureCategory === 'legacy_portal'
                ? `${detection.detectedPlatform} (Legacy)`
                : detection.detectedPlatform
              : detection.failureCategory === 'unreachable'
                ? 'Site unreachable'
                : detection.failureCategory === 'timeout'
                  ? 'Connection timeout'
                  : detection.failureCategory === 'blocked'
                    ? 'Access blocked'
                    : detection.failureCategory === 'invalid_url'
                      ? 'Invalid URL'
                      : 'No supported ATS detected'}{' '}
            ·{' '}
            {detection.failureCategory === 'legacy_portal'
              ? 'legacy-unsupported'
              : detection.failureCategory === 'blocked'
                ? 'blocked'
                : detection.failureCategory === 'timeout'
                  ? 'timeout'
                  : detection.failureCategory === 'unreachable'
                    ? 'unreachable'
                    : detection.failureCategory === 'invalid_url'
                      ? 'invalid-url'
                      : detection.supportState}
          </strong>
          <span>
            Confidence {Math.round(detection.confidence * 100)}% ·{' '}
            {detection.explanation}
          </span>
          {detection.suggestedProvider === null ? null : (
            <button type="button" onClick={applyDetection} disabled={busy}>
              Apply detected configuration
            </button>
          )}
        </div>
      )}
      {validation?.preview === null ||
      validation?.preview === undefined ? null : (
        <div className="source-preview">
          <strong>
            {validation.preview.jobCount} jobs detected ·{' '}
            {validation.preview.format}
          </strong>
          {validation.preview.samples.map((sample) => (
            <span key={`${sample.company}-${sample.title}`}>
              {sample.title} · {sample.company}
            </span>
          ))}
        </div>
      )}
      {message ? (
        <p role="status" className="desktop-message">
          {message}
        </p>
      ) : null}
      <div className="card-actions">
        <button type="button" onClick={() => void validate()} disabled={busy}>
          Validate
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => void save()}
          disabled={busy || validation?.valid !== true}
        >
          Save source
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function ProviderFields({
  providerId,
  configuration,
  update,
}: {
  providerId: string;
  configuration: Record<string, unknown>;
  update: (key: string, value: unknown) => void;
}) {
  if (providerId === 'greenhouse')
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label>
          Board token
          <input
            value={textValue(configuration['boardToken'])}
            onChange={(event) => update('boardToken', event.target.value)}
          />
        </label>
        <span
          className="field-helper"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            marginTop: '0.25rem',
          }}
        >
          The Greenhouse board token (e.g. "stripe" from
          boards.greenhouse.io/stripe)
        </span>
      </div>
    );
  if (providerId === 'smartrecruiters')
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label>
          Company identifier
          <input
            value={textValue(configuration['companyIdentifier'])}
            onChange={(event) =>
              update('companyIdentifier', event.target.value)
            }
          />
        </label>
        <span
          className="field-helper"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            marginTop: '0.25rem',
          }}
        >
          The SmartRecruiters company identifier (e.g. "boschgroup")
        </span>
      </div>
    );
  if (providerId === 'bamboohr')
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label>
          BambooHR company domain
          <input
            value={textValue(configuration['companyDomain'])}
            onChange={(event) => update('companyDomain', event.target.value)}
          />
        </label>
        <span
          className="field-helper"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            marginTop: '0.25rem',
          }}
        >
          The BambooHR company subdomain (e.g. "g2" from g2.bamboohr.com)
        </span>
      </div>
    );
  if (providerId === 'recruitee')
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label>
          Recruitee origin
          <input
            type="url"
            value={textValue(configuration['origin'])}
            onChange={(event) => update('origin', event.target.value)}
          />
        </label>
        <span
          className="field-helper"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            marginTop: '0.25rem',
          }}
        >
          The full HTTPS origin URL of the Recruitee board (e.g.
          https://bunq.recruitee.com)
        </span>
      </div>
    );
  if (providerId === 'teamtailor')
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label>
          Teamtailor RSS feed
          <input
            type="url"
            value={textValue(configuration['feedUrl'])}
            onChange={(event) => update('feedUrl', event.target.value)}
          />
        </label>
        <span
          className="field-helper"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            marginTop: '0.25rem',
          }}
        >
          The Teamtailor XML/RSS feed URL (e.g.
          https://company.teamtailor.com/jobs.rss)
        </span>
      </div>
    );
  if (providerId === 'workable')
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label>
          Workable subdomain
          <input
            value={textValue(configuration['subdomain'])}
            onChange={(event) => update('subdomain', event.target.value)}
          />
        </label>
        <span
          className="field-helper"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            marginTop: '0.25rem',
          }}
        >
          The Workable account subdomain (e.g. &quot;huggingface&quot; from
          apply.workable.com/huggingface)
        </span>
      </div>
    );
  if (providerId === 'icims')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column' }}>
          iCIMS portal URL
          <input
            value={textValue(configuration['portalUrl'])}
            onChange={(event) => update('portalUrl', event.target.value)}
            placeholder="https://careers.example.com"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column' }}>
          Portal Variant
          <select
            value={textValue(configuration['variant'])}
            onChange={(event) =>
              update('variant', event.target.value || undefined)
            }
            style={{
              padding: '0.4rem',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--background)',
              color: 'var(--foreground)',
              marginTop: '0.25rem',
            }}
          >
            <option value="">Auto-detect Variant</option>
            <option value="jibe_json">Jibe API JSON Feed (jibe_json)</option>
            <option value="icims_hosted_v1">
              iCIMS Hosted Web v1 (icims_hosted_v1)
            </option>
            <option value="icims_hosted_v2">
              iCIMS Hosted JSON v2 (icims_hosted_v2)
            </option>
          </select>
        </label>
        <span
          className="field-helper"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            marginTop: '0.25rem',
          }}
        >
          Enter the portal URL detected from the employer’s public careers page.
        </span>
      </div>
    );
  if (providerId === 'lever')
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label>
          Lever site
          <input
            value={textValue(configuration['site'])}
            onChange={(event) => update('site', event.target.value)}
          />
        </label>
        <span
          className="field-helper"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            marginTop: '0.25rem',
          }}
        >
          The Lever site slug (e.g. "wealthfront" from
          jobs.lever.co/wealthfront)
        </span>
      </div>
    );
  if (providerId === 'ashby')
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label>
          Ashby board name
          <input
            value={textValue(configuration['boardName'])}
            onChange={(event) => update('boardName', event.target.value)}
          />
        </label>
        <span
          className="field-helper"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            marginTop: '0.25rem',
          }}
        >
          The Ashby board name (e.g. "ramp" from jobs.ashbyhq.com/ramp)
        </span>
      </div>
    );
  if (providerId === 'workday')
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label>
            Workday origin
            <input
              value={textValue(configuration['origin'])}
              onChange={(event) => update('origin', event.target.value)}
            />
          </label>
          <span
            className="field-helper"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              color: 'var(--muted)',
              marginTop: '0.25rem',
            }}
          >
            The full HTTPS origin (e.g. https://company.myworkdayjobs.com)
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label>
            Tenant
            <input
              value={textValue(configuration['tenant'])}
              onChange={(event) => update('tenant', event.target.value)}
            />
          </label>
          <span
            className="field-helper"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              color: 'var(--muted)',
              marginTop: '0.25rem',
            }}
          >
            The Workday tenant name (e.g. "company")
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label>
            Site
            <input
              value={textValue(configuration['site'])}
              onChange={(event) => update('site', event.target.value)}
            />
          </label>
          <span
            className="field-helper"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              color: 'var(--muted)',
              marginTop: '0.25rem',
            }}
          >
            The Workday site code (e.g. "External")
          </span>
        </div>
      </>
    );
  if (providerId === 'structured-data')
    return (
      <p className="field-note span-2">
        The careers URL must expose JSON-LD JobPosting, a public JSON feed, RSS,
        or Atom.
      </p>
    );
  if (providerId === 'usajobs')
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          gridColumn: '1 / -1',
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: '0.95rem',
            marginBottom: '0.25rem',
          }}
        >
          Search terms
        </div>
        {(() => {
          const queries: { keywords: string }[] = (
            Array.isArray(configuration['queries'])
              ? (configuration['queries'] as Record<string, unknown>[])
              : []
          ).map((q) => ({
            keywords: typeof q['keywords'] === 'string' ? q['keywords'] : '',
          }));
          if (queries.length === 0)
            queries.push({
              keywords: textValue(configuration['searchKeywords']),
            });
          return queries.map((q, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--background-secondary, rgba(0,0,0,0.02))',
              }}
            >
              <input
                value={q.keywords}
                onChange={(e) => {
                  const updated = [...queries];
                  updated[i] = { keywords: e.target.value };
                  update('queries', updated);
                  update('searchKeywords', e.target.value);
                }}
                placeholder="systems administrator"
                style={{
                  flex: 1,
                  padding: '0.4rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                }}
              />
              {queries.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const updated = queries.filter((_, j) => j !== i);
                    update('queries', updated);
                    if (updated.length > 0)
                      update('searchKeywords', updated[0]?.keywords ?? '');
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid #dc3545',
                    color: '#dc3545',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.8rem',
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ));
        })()}
        <button
          type="button"
          onClick={() => {
            const existing: Record<string, unknown>[] = Array.isArray(
              configuration['queries'],
            )
              ? (configuration['queries'] as Record<string, unknown>[])
              : [
                  {
                    keywords:
                      configuration['searchKeywords'] ??
                      'systems administrator',
                  },
                ];
            update('queries', [...existing, { keywords: '' }]);
          }}
          style={{
            background: 'none',
            border: '1px dashed var(--border)',
            color: 'var(--foreground)',
            borderRadius: '4px',
            cursor: 'pointer',
            padding: '0.4rem 0.75rem',
            fontSize: '0.85rem',
            opacity: 0.7,
          }}
        >
          + Add search term
        </button>
        <label>
          Search location
          <input
            value={textValue(configuration['location'])}
            onChange={(event) => update('location', event.target.value)}
            placeholder="Remote or Amarillo, TX"
          />
        </label>
        <label>
          Workplace type
          <select
            value={textValue(configuration['remoteFilter'])}
            onChange={(event) =>
              update('remoteFilter', event.target.value || '')
            }
          >
            <option value="">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
        </label>
        <label>
          Date posted
          <select
            value={textValue(configuration['datePosted']) || 'any'}
            onChange={(event) => update('datePosted', event.target.value)}
          >
            <option value="any">Any time</option>
            <option value="24h">Past 24 hours</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
          </select>
        </label>
        <label>
          Maximum results
          <input
            type="number"
            min={1}
            max={100}
            value={Number(configuration['maxResults'] ?? 50)}
            onChange={(event) =>
              update('maxResults', Number(event.target.value))
            }
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={Boolean(configuration['keepBrowserOpen'] ?? true)}
            onChange={(event) =>
              update('keepBrowserOpen', event.target.checked)
            }
          />{' '}
          Keep browser open after search
        </label>
        <div
          className="source-editor-warning"
          style={{
            padding: '0.75rem',
            borderRadius: '4px',
            background: 'var(--warning-bg, #fff3cd)',
            border: '1px solid var(--warning-border, #ffc107)',
            fontSize: '0.85rem',
            lineHeight: '1.4',
          }}
        >
          <strong>USAJOBS provider notice:</strong>
          <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem' }}>
            <li>
              Discovery opens a visible browser window and signs you in with
              your existing login.gov account.
            </li>
            <li>
              The first run asks you to agree and complete login.gov sign-in
              (including MFA). Your session is saved locally.
            </li>
            <li>
              Search results load even without signing in, but signing in keeps
              your profile available for applications you open.
            </li>
            <li>
              Your login.gov password is never stored by this application.
            </li>
          </ul>
        </div>
      </div>
    );
  if (
    providerId === 'builtin' ||
    providerId === 'wellfound' ||
    providerId === 'ziprecruiter'
  )
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          gridColumn: '1 / -1',
        }}
      >
        <label>
          Search terms
          <input
            value={textValue(configuration['searchKeywords'])}
            onChange={(event) => update('searchKeywords', event.target.value)}
            placeholder="systems administrator"
          />
        </label>
        <label>
          Search location
          <input
            value={textValue(configuration['location'])}
            onChange={(event) => update('location', event.target.value)}
            placeholder="Remote or San Francisco, CA"
          />
        </label>
        <label>
          Workplace type
          <select
            value={textValue(configuration['remoteFilter'])}
            onChange={(event) =>
              update('remoteFilter', event.target.value || '')
            }
          >
            <option value="">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
        </label>
        <label>
          Date posted
          <select
            value={textValue(configuration['datePosted']) || 'any'}
            onChange={(event) => update('datePosted', event.target.value)}
          >
            <option value="any">Any time</option>
            <option value="24h">Past 24 hours</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
          </select>
        </label>
        <label>
          Maximum results
          <input
            type="number"
            min={1}
            max={100}
            value={Number(configuration['maxResults'] ?? 50)}
            onChange={(event) =>
              update('maxResults', Number(event.target.value))
            }
          />
        </label>
        {providerId === 'builtin' ? null : (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={Boolean(configuration['keepBrowserOpen'] ?? true)}
              onChange={(event) =>
                update('keepBrowserOpen', event.target.checked)
              }
            />{' '}
            Keep browser open after search
          </label>
        )}
        {providerId === 'builtin' ? (
          <p className="field-note">
            Built In is fetched directly over HTTPS. Job detail pages are loaded
            automatically for descriptions and salary data.
          </p>
        ) : (
          <div className="source-editor-warning">
            <strong>
              {providerId === 'wellfound' ? 'Wellfound' : 'ZipRecruiter'}{' '}
              browser notice:
            </strong>{' '}
            discovery opens a visible browser window and may require completing
            the site security check. Session data stays in the local app
            profile.
          </div>
        )}
      </div>
    );
  if (providerId === 'linkedin')
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          gridColumn: '1 / -1',
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: '0.95rem',
            marginBottom: '0.25rem',
          }}
        >
          Search terms
        </div>
        {(() => {
          const queries: { keywords: string }[] = (
            Array.isArray(configuration['queries'])
              ? (configuration['queries'] as Record<string, unknown>[])
              : []
          ).map((q) => ({
            keywords: typeof q['keywords'] === 'string' ? q['keywords'] : '',
          }));
          if (queries.length === 0) {
            queries.push({
              keywords: textValue(configuration['searchKeywords']),
            });
          }
          return queries.map((q, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--background-secondary, rgba(0,0,0,0.02))',
              }}
            >
              <input
                value={q.keywords}
                onChange={(e) => {
                  const updated = [...queries];
                  updated[i] = { keywords: e.target.value };
                  update('queries', updated);
                  update('searchKeywords', e.target.value);
                }}
                placeholder="systems administrator"
                style={{
                  flex: 1,
                  padding: '0.4rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                }}
              />
              {queries.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const updated = queries.filter((_, j) => j !== i);
                    update('queries', updated);
                    if (updated.length > 0) {
                      update('searchKeywords', updated[0]?.keywords ?? '');
                    }
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid #dc3545',
                    color: '#dc3545',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.8rem',
                  }}
                  title="Remove this search term"
                >
                  ×
                </button>
              )}
            </div>
          ));
        })()}
        <button
          type="button"
          onClick={() => {
            const existing: Record<string, unknown>[] = Array.isArray(
              configuration['queries'],
            )
              ? (configuration['queries'] as Record<string, unknown>[])
              : [
                  {
                    keywords:
                      configuration['searchKeywords'] ??
                      'systems administrator',
                  },
                ];
            update('queries', [...existing, { keywords: '' }]);
          }}
          style={{
            background: 'none',
            border: '1px dashed var(--border)',
            color: 'var(--foreground)',
            borderRadius: '4px',
            cursor: 'pointer',
            padding: '0.4rem 0.75rem',
            fontSize: '0.85rem',
            opacity: 0.7,
          }}
        >
          + Add search term
        </button>
        <div style={{ height: '0.25rem' }} />
        <label>
          Workplace type
          <select
            value={textValue(configuration['remoteFilter'])}
            onChange={(event) =>
              update('remoteFilter', event.target.value || '')
            }
            style={{
              padding: '0.4rem',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--background)',
              color: 'var(--foreground)',
              marginTop: '0.25rem',
            }}
          >
            <option value="">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
        </label>
        <label>
          Date posted
          <select
            value={textValue(configuration['datePosted'])}
            onChange={(event) =>
              update('datePosted', event.target.value || 'any')
            }
            style={{
              padding: '0.4rem',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--background)',
              color: 'var(--foreground)',
              marginTop: '0.25rem',
            }}
          >
            <option value="any">Any time</option>
            <option value="24h">Past 24 hours</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
          </select>
        </label>
        <label>
          Experience level
          <input
            value={textValue(configuration['experienceLevel'])}
            onChange={(event) => update('experienceLevel', event.target.value)}
            placeholder="e.g. senior, entry, mid"
          />
        </label>
        <label>
          Employment type
          <input
            value={textValue(configuration['employmentType'])}
            onChange={(event) => update('employmentType', event.target.value)}
            placeholder="e.g. full-time, contract"
          />
        </label>
        <label>
          Distance (miles)
          <input
            type="number"
            min={0}
            max={100}
            value={Number(configuration['distance'] ?? 25)}
            onChange={(event) => update('distance', Number(event.target.value))}
          />
        </label>
        <label>
          Minimum salary
          <input
            type="number"
            min={0}
            value={Number(configuration['minSalary'] ?? 0)}
            onChange={(event) =>
              update('minSalary', Number(event.target.value))
            }
            placeholder="0"
          />
        </label>
        <label>
          Maximum results
          <input
            type="number"
            min={1}
            max={100}
            value={Number(configuration['maxResults'] ?? 50)}
            onChange={(event) =>
              update('maxResults', Number(event.target.value))
            }
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={Boolean(configuration['keepBrowserOpen'] ?? true)}
            onChange={(event) =>
              update('keepBrowserOpen', event.target.checked)
            }
          />{' '}
          Keep browser open after search
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={Boolean(configuration['debugMode'])}
            onChange={(event) => update('debugMode', event.target.checked)}
          />{' '}
          Debug mode (detailed logging)
        </label>
        <div
          className="source-editor-warning"
          style={{
            padding: '0.75rem',
            borderRadius: '4px',
            background: 'var(--warning-bg, #fff3cd)',
            border: '1px solid var(--warning-border, #ffc107)',
            fontSize: '0.85rem',
            lineHeight: '1.4',
          }}
        >
          <strong>LinkedIn provider notice:</strong>
          <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem' }}>
            <li>
              This provider opens a visible browser window for manual login.
            </li>
            <li>Your LinkedIn password is never stored by this application.</li>
            <li>Browser profile (cookies, session) is stored locally only.</li>
            <li>
              LinkedIn may change its website, which can break this provider.
            </li>
            <li>
              No automated applications, messages, or connection requests are
              sent.
            </li>
          </ul>
        </div>
      </div>
    );
  if (providerId === 'dice')
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          gridColumn: '1 / -1',
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: '0.95rem',
            marginBottom: '0.25rem',
          }}
        >
          Search terms
        </div>
        {(() => {
          const queries: { keywords: string }[] = (
            Array.isArray(configuration['queries'])
              ? (configuration['queries'] as Record<string, unknown>[])
              : []
          ).map((q) => ({
            keywords: typeof q['keywords'] === 'string' ? q['keywords'] : '',
          }));
          if (queries.length === 0)
            queries.push({
              keywords: textValue(configuration['searchKeywords']),
            });
          return queries.map((q, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--background-secondary, rgba(0,0,0,0.02))',
              }}
            >
              <input
                value={q.keywords}
                onChange={(e) => {
                  const updated = [...queries];
                  updated[i] = { keywords: e.target.value };
                  update('queries', updated);
                  update('searchKeywords', e.target.value);
                }}
                placeholder="systems administrator"
                style={{
                  flex: 1,
                  padding: '0.4rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                }}
              />
              {queries.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const updated = queries.filter((_, j) => j !== i);
                    update('queries', updated);
                    if (updated.length > 0)
                      update('searchKeywords', updated[0]?.keywords ?? '');
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid #dc3545',
                    color: '#dc3545',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.8rem',
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ));
        })()}
        <button
          type="button"
          onClick={() => {
            const existing: Record<string, unknown>[] = Array.isArray(
              configuration['queries'],
            )
              ? (configuration['queries'] as Record<string, unknown>[])
              : [
                  {
                    keywords:
                      configuration['searchKeywords'] ??
                      'systems administrator',
                  },
                ];
            update('queries', [...existing, { keywords: '' }]);
          }}
          style={{
            background: 'none',
            border: '1px dashed var(--border)',
            color: 'var(--foreground)',
            borderRadius: '4px',
            cursor: 'pointer',
            padding: '0.4rem 0.75rem',
            fontSize: '0.85rem',
            opacity: 0.7,
          }}
        >
          + Add search term
        </button>
        <label>
          Location
          <input
            value={textValue(configuration['location'])}
            onChange={(e) => update('location', e.target.value)}
            placeholder="San Francisco, CA"
          />
        </label>
        <label>
          Remote
          <select
            value={textValue(configuration['remoteFilter'])}
            onChange={(e) => update('remoteFilter', e.target.value || '')}
            style={{
              padding: '0.4rem',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--background)',
              color: 'var(--foreground)',
              marginTop: '0.25rem',
            }}
          >
            <option value="">Any</option>
            <option value="remote">Remote only</option>
          </select>
        </label>
        <label>
          Date posted
          <select
            value={textValue(configuration['datePosted'])}
            onChange={(e) => update('datePosted', e.target.value || 'any')}
            style={{
              padding: '0.4rem',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--background)',
              color: 'var(--foreground)',
              marginTop: '0.25rem',
            }}
          >
            <option value="any">Any time</option>
            <option value="24h">Past 24 hours</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
          </select>
        </label>
        <label>
          Maximum results
          <input
            type="number"
            min={1}
            max={100}
            value={Number(configuration['maxResults'] ?? 50)}
            onChange={(e) => update('maxResults', Number(e.target.value))}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={Boolean(configuration['keepBrowserOpen'] ?? true)}
            onChange={(e) => update('keepBrowserOpen', e.target.checked)}
          />{' '}
          Keep browser open after search
        </label>
        <div
          className="source-editor-warning"
          style={{
            padding: '0.75rem',
            borderRadius: '4px',
            background: 'var(--warning-bg, #fff3cd)',
            border: '1px solid var(--warning-border, #ffc107)',
            fontSize: '0.85rem',
            lineHeight: '1.4',
          }}
        >
          <strong>Dice provider notice:</strong>
          <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.25rem' }}>
            <li>
              This provider opens a visible browser window for manual login.
            </li>
            <li>Your Dice password is never stored by this application.</li>
            <li>Browser profile (cookies, session) is stored locally only.</li>
          </ul>
        </div>
      </div>
    );
  if (providerId === 'cisco' || providerId === 'crowdstrike')
    return (
      <p className="field-note span-2">
        This provider uses the Workday API. No additional configuration needed.
      </p>
    );
  return null;
}

function configurationFor(
  providerId: string,
  current: Record<string, unknown>,
  careersUrl: string,
  employer: string,
): Record<string, unknown> {
  if (providerId === 'structured-data') return { url: careersUrl.trim() };
  if (
    [
      'greenhouse',
      'lever',
      'ashby',
      'workday',
      'smartrecruiters',
      'bamboohr',
      'recruitee',
      'teamtailor',
      'workable',
      'icims',
      'cisco',
      'crowdstrike',
    ].includes(providerId)
  ) {
    const next: Record<string, unknown> = {
      ...current,
      ...(employer.trim() ? { company: employer.trim() } : {}),
    };
    if (providerId === 'icims') {
      const portalUrl = textValue(next['portalUrl']).trim();
      if (portalUrl === '') {
        const origin = originOf(careersUrl);
        if (origin !== null) next['portalUrl'] = origin;
      }
    }
    if (providerId === 'smartrecruiters') {
      const companyIdentifier = textValue(
        next['companyIdentifier'],
      ).trim();
      if (companyIdentifier === '') {
        const slug = smartRecruitersSlug(careersUrl);
        if (slug !== null) next['companyIdentifier'] = slug;
      }
    }
    return next;
  }
  return current;
}

function missingConfigGuidance(
  providerId: string,
  configuration: Record<string, unknown>,
): string | null {
  if (providerId === 'icims' && textValue(configuration['portalUrl']).trim() === '')
    return 'Enter the iCIMS portal URL (the employer’s public careers page) or type it in the iCIMS portal URL field, then validate again.';
  if (
    providerId === 'smartrecruiters' &&
    textValue(configuration['companyIdentifier']).trim() === ''
  )
    return 'Enter the SmartRecruiters company identifier (e.g. "continental" from jobs.smartrecruiters.com/continental) or the employer’s public careers URL, then validate again.';
  if (providerId === 'greenhouse' && textValue(configuration['boardToken']).trim() === '')
    return 'Enter the Greenhouse board token (e.g. "stripe" from boards.greenhouse.io/stripe), then validate again.';
  if (providerId === 'lever' && textValue(configuration['site']).trim() === '')
    return 'Enter the Lever site (e.g. "acme" from jobs.lever.co/acme), then validate again.';
  if (providerId === 'bamboohr' && textValue(configuration['companyDomain']).trim() === '')
    return 'Enter the BambooHR company domain (e.g. "g2" from g2.bamboohr.com), then validate again.';
  if (providerId === 'recruitee' && textValue(configuration['origin']).trim() === '')
    return 'Enter the Recruitee origin URL (e.g. https://bunq.recruitee.com), then validate again.';
  if (providerId === 'teamtailor' && textValue(configuration['feedUrl']).trim() === '')
    return 'Enter the Teamtailor RSS feed URL (e.g. https://company.teamtailor.com/jobs.rss), then validate again.';
  if (providerId === 'workable' && textValue(configuration['subdomain']).trim() === '')
    return 'Enter the Workable account subdomain (e.g. "huggingface" from apply.workable.com/huggingface), then validate again.';
  return null;
}

function originOf(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

function smartRecruitersSlug(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const host = url.hostname.toLowerCase();
    if (
      host !== 'jobs.smartrecruiters.com' &&
      host !== 'careers.smartrecruiters.com'
    )
      return null;
    const slug = url.pathname.split('/').find(Boolean);
    if (slug === undefined || slug === '') return null;
    try {
      return decodeURIComponent(slug);
    } catch {
      return slug;
    }
  } catch {
    return null;
  }
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
