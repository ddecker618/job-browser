import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  CareerSiteSummary,
  EmployerWithSites,
} from '../../models/employer.js';
import { api } from '../api.js';
import {
  formatDateOnly,
  formatExactDateTime,
} from '../applicationFormatting.js';
import { PageHeader } from '../components/PageHeader.js';
import { EmptyState, ErrorState, LoadingState } from '../components/States.js';
import { invalidateScoreQueries } from '../scoreCache.js';

export function EmployersPage() {
  const client = useQueryClient();
  const [addingEmployer, setAddingEmployer] = useState(false);
  const [addingSiteForEmployer, setAddingSiteForEmployer] = useState<
    string | null
  >(null);
  const [newEmployerName, setNewEmployerName] = useState('');
  const [newEmployerUrl, setNewEmployerUrl] = useState('');
  const [newSiteUrl, setNewSiteUrl] = useState('');
  const [expandedEmployerId, setExpandedEmployerId] = useState<string | null>(
    null,
  );
  const [creatingSourceForSite, setCreatingSourceForSite] = useState<
    string | null
  >(null);
  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null);
  const [seedName, setSeedName] = useState('');
  const [seedUrl, setSeedUrl] = useState('');
  const [historySummary, setHistorySummary] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const employers = useQuery({
    queryKey: ['employers'],
    queryFn: api.employers,
  });
  const intelligence = useQuery({
    queryKey: ['employer-discovery-intelligence'],
    queryFn: () => api.employerDiscoveryIntelligence(),
  });
  const sourceControl = useQuery({
    queryKey: ['source-control-center'],
    queryFn: api.sourceControlCenter,
    refetchInterval: (query) =>
      query.state.data?.discovery?.running === true ? 1500 : 30_000,
  });

  const refreshDiscoveryState = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['employers'] }),
      client.invalidateQueries({
        queryKey: ['employer-discovery-intelligence'],
      }),
      client.invalidateQueries({ queryKey: ['source-control-center'] }),
      invalidateScoreQueries(client),
    ]);
  };

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.verifyCareerSite(id),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['employers'] });
      await client.invalidateQueries({
        queryKey: ['employer-discovery-intelligence'],
      });
    },
  });

  const createSourceMutation = useMutation({
    mutationFn: (id: string) => api.discoverCareerSite(id),
    onSettled: async () => {
      setCreatingSourceForSite(null);
      await client.invalidateQueries({ queryKey: ['employers'] });
    },
  });

  const runDiscoveryMutation = useMutation({
    mutationFn: api.runEmployerDiscovery,
    onMutate: () => setLastRunSummary(null),
    onSuccess: (result) => {
      setLastRunSummary(
        `${String(result.attempted)} attempted, ${String(result.sourceCreated)} created, ${String(result.sourceReused)} reused, ${String(result.unsupported)} unknown/unsupported, ${String(result.credentialRequired)} credentials required, ${String(result.skipped)} safety-skipped, ${String(result.failed)} failed`,
      );
    },
    onSettled: async () => refreshDiscoveryState(),
  });
  const runEnabledSourcesMutation = useMutation({
    mutationFn: api.runAllSources,
    onMutate: () => setLastRunSummary(null),
    onSuccess: (results) => {
      const jobsFound = results.reduce(
        (sum, result) => sum + result.jobsFound,
        0,
      );
      const jobsInserted = results.reduce(
        (sum, result) => sum + result.jobsInserted,
        0,
      );
      setLastRunSummary(
        `Enabled Sources: ${String(results.length)} run summaries, ${String(jobsFound)} jobs found, ${String(jobsInserted)} inserted`,
      );
    },
    onSettled: async () => refreshDiscoveryState(),
  });
  const healthCheckMutation = useMutation({
    mutationFn: api.runCareerSiteHealth,
    onMutate: () => setLastRunSummary(null),
    onSuccess: (result) => {
      setLastRunSummary(
        `CareerSite health: ${String(result.checked)} checked, ${String(result.healthy)} healthy, ${String(result.warning)} warning, ${String(result.broken)} broken, ${String(result.skipped)} skipped`,
      );
    },
    onSettled: async () => refreshDiscoveryState(),
  });
  const importSeedMutation = useMutation({
    mutationFn: () =>
      api.importEmployerSeeds([
        {
          name: seedName.trim(),
          websiteUrl: null,
          careerSiteUrls: [seedUrl.trim()],
          provenance: 'manual-employers-page',
        },
      ]),
    onSuccess: (result) => {
      setLastRunSummary(
        `Seed import: ${String(result.employersCreated)} Employer and ${String(result.careerSitesCreated)} CareerSite created; ${String(result.careerSitesReused)} reused`,
      );
      setSeedName('');
      setSeedUrl('');
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['employers'] });
    },
  });
  const healthMutation = useMutation({
    mutationFn: (id: string) => api.checkCareerSiteHealth(id),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['employers'] });
      await client.invalidateQueries({
        queryKey: ['employer-discovery-intelligence'],
      });
    },
  });
  const repairMutation = useMutation({
    mutationFn: (id: string) => api.repairCareerSite(id),
    onSuccess: (result) => setLastRunSummary(result.reason),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['employers'] });
      await client.invalidateQueries({
        queryKey: ['employer-discovery-intelligence'],
      });
    },
  });
  const historyMutation = useMutation({
    mutationFn: (id: string) => api.careerSiteVerificationHistory(id),
    onSuccess: (history) => {
      setHistorySummary(
        history.length === 0
          ? 'No retained health verification history.'
          : history
              .slice(0, 5)
              .map(
                (item) =>
                  `${new Date(item.observedAt).toLocaleString()}: ${item.previousHealthStatus} -> ${item.resultingHealthStatus} (${item.reason})`,
              )
              .join(' | '),
      );
    },
  });

  const createEmployerMutation = useMutation({
    mutationFn: (input: { name: string; websiteUrl: string | null }) =>
      api.createEmployer(input),
    onSettled: async () => {
      setAddingEmployer(false);
      setNewEmployerName('');
      setNewEmployerUrl('');
      await client.invalidateQueries({ queryKey: ['employers'] });
    },
  });

  const createSiteMutation = useMutation({
    mutationFn: ({ employerId, url }: { employerId: string; url: string }) =>
      api.createCareerSite(employerId, { url }),
    onSettled: async () => {
      setAddingSiteForEmployer(null);
      setNewSiteUrl('');
      await client.invalidateQueries({ queryKey: ['employers'] });
    },
  });

  if (employers.isPending)
    return <LoadingState label="Loading employer registry" />;
  if (employers.isError)
    return <ErrorState error={employers.error} title="Employers unavailable" />;

  const handleAddEmployer = () => {
    if (newEmployerName.trim() === '') return;
    createEmployerMutation.mutate({
      name: newEmployerName.trim(),
      websiteUrl: newEmployerUrl.trim() || null,
    });
  };

  const handleAddSite = (employerId: string) => {
    createSiteMutation.mutate({ employerId, url: newSiteUrl.trim() });
  };

  const handleVerify = (siteId: string) => {
    verifyMutation.mutate(siteId);
  };

  const handleCreateSource = (siteId: string) => {
    setCreatingSourceForSite(siteId);
    createSourceMutation.mutate(siteId);
  };

  const visibleEmployers = employers.data;
  const healthSummary = visibleEmployers
    .flatMap((entry) => entry.careerSites)
    .reduce<Record<string, number>>((summary, site) => {
      summary[site.health.status] = (summary[site.health.status] ?? 0) + 1;
      return summary;
    }, {});
  const totalCareerSites = visibleEmployers.reduce(
    (sum, entry) => sum + entry.careerSites.length,
    0,
  );
  const intelligenceSites = intelligence.data?.sites ?? [];
  const retiredSites = intelligenceSites.filter(
    (site) => site.healthStatus === 'retired',
  );
  const activeSites = intelligenceSites.filter(
    (site) => site.healthStatus !== 'retired',
  );
  const coordinatorRunning = sourceControl.data?.discovery?.running === true;
  const globalRunPending =
    runDiscoveryMutation.isPending ||
    runEnabledSourcesMutation.isPending ||
    healthCheckMutation.isPending ||
    coordinatorRunning;
  const runError =
    runDiscoveryMutation.error ??
    runEnabledSourcesMutation.error ??
    healthCheckMutation.error;

  return (
    <>
      <PageHeader
        eyebrow="Discovery control center"
        title="Discovery Engine"
        description="Manage Employer CareerSites, ATS detection, Source mapping, discovery execution, health, and optional scheduling through the existing provider pipeline."
      />
      <section
        className="discovery-intelligence"
        aria-labelledby="discovery-control-center-title"
      >
        <div className="discovery-intelligence-heading">
          <div>
            <span className="eyebrow">Operational state</span>
            <h2 id="discovery-control-center-title">
              Discovery Control Center
            </h2>
          </div>
          <span
            className={`health-pill ${globalRunPending ? 'warning' : 'healthy'}`}
          >
            {globalRunPending ? 'Running' : 'Idle'}
          </span>
        </div>
        <div className="discovery-intelligence-metrics">
          <Metric
            label="Employer Discovery"
            value={
              sourceControl.data?.employerDiscoveryEnabled === true
                ? 'Enabled'
                : 'Disabled'
            }
          />
          <Metric
            label="Source scheduling"
            value={
              sourceControl.data?.schedulerEnabled === true
                ? 'Enabled'
                : 'Disabled'
            }
          />
          <Metric
            label="CareerSites eligible now"
            value={intelligence.data?.totals.eligibleSites ?? 0}
          />
          <Metric
            label="Due within 24h"
            value={intelligence.data?.totals.dueSoon ?? 0}
          />
          <Metric label="Total CareerSites" value={totalCareerSites} />
          <Metric
            label="Sources enabled"
            value={sourceControl.data?.summary.enabledSources ?? 0}
          />
        </div>
        <div className="source-toolbar">
          <button
            className="button primary"
            type="button"
            onClick={() => runDiscoveryMutation.mutate()}
            disabled={globalRunPending}
          >
            {runDiscoveryMutation.isPending
              ? 'Running Discovery...'
              : 'Run Discovery Now'}
          </button>
          <button
            className="button"
            type="button"
            onClick={() => runEnabledSourcesMutation.mutate()}
            disabled={globalRunPending}
          >
            {runEnabledSourcesMutation.isPending
              ? 'Running Enabled Sources...'
              : 'Run Enabled Sources'}
          </button>
          <button
            className="button"
            type="button"
            onClick={() => healthCheckMutation.mutate()}
            disabled={globalRunPending}
          >
            {healthCheckMutation.isPending
              ? 'Checking CareerSite Health...'
              : 'Check CareerSite Health'}
          </button>
          <span role="status">
            {coordinatorRunning
              ? `Running ${sourceControl.data?.discovery?.activeSourceId ?? 'discovery'} · ${String(sourceControl.data?.discovery?.completedSources ?? 0)}/${String(sourceControl.data?.discovery?.totalSources ?? 0)}`
              : `${String(sourceControl.data?.summary.enabledSources ?? 0)} enabled Sources`}
          </span>
        </div>
        {sourceControl.isError ? (
          <p className="source-error" role="alert">
            Source control state is unavailable.
          </p>
        ) : null}
        {runError === null ? null : (
          <p className="source-error" role="alert">
            {runError.message}
          </p>
        )}
        {sourceControl.data?.discovery?.lastError ? (
          <p className="source-error" role="alert">
            {sourceControl.data.discovery.lastError}
          </p>
        ) : null}
        {lastRunSummary !== null ? (
          <p className="source-summary" role="status" aria-live="polite">
            Last run: {lastRunSummary}
          </p>
        ) : null}
      </section>
      <h2 className="source-section-title">CareerSite Health</h2>
      <p className="health-summary-note">
        CareerSite health comes from bounded ATS-detection probes and is
        separate from Source run success, which is shown under Discovery
        Intelligence.
      </p>
      <div
        className="analytics-kpis"
        aria-label="CareerSite health summary counts"
      >
        {(['healthy', 'warning', 'broken', 'unknown', 'retired'] as const).map(
          (status) => (
            <article key={status}>
              <span>{status}</span>
              <strong>{String(healthSummary[status] ?? 0)}</strong>
            </article>
          ),
        )}
        <article>
          <span>total</span>
          <strong>{String(totalCareerSites)}</strong>
        </article>
      </div>
      <section
        className="discovery-intelligence"
        aria-labelledby="discovery-intelligence-title"
      >
        <div className="discovery-intelligence-heading">
          <div>
            <span className="eyebrow">Deterministic operational policy</span>
            <h2 id="discovery-intelligence-title">Discovery Intelligence</h2>
          </div>
          {intelligence.data !== undefined ? (
            <code>{intelligence.data.policyVersion}</code>
          ) : null}
        </div>
        {intelligence.isPending ? (
          <p>Evaluating retained discovery evidence…</p>
        ) : intelligence.isError ? (
          <p>Discovery intelligence is unavailable.</p>
        ) : (
          <>
            <div className="discovery-intelligence-metrics">
              <Metric
                label="Eligible now"
                value={intelligence.data.totals.eligibleSites}
              />
              <Metric
                label="Due within 24h"
                value={intelligence.data.totals.dueSoon}
              />
              <Metric
                label="Successful runs, last 30 days"
                value={intelligence.data.totals.discoverySuccesses}
              />
              <Metric
                label="Failed runs, last 30 days"
                value={intelligence.data.totals.discoveryFailures}
              />
            </div>
            <small className="activity-window">
              Activity window{' '}
              {formatDateOnly(intelligence.data.activityWindow.start)} to{' '}
              {formatDateOnly(intelligence.data.activityWindow.end)}
            </small>
            <div className="discovery-intelligence-sites">
              {activeSites.map((site) => (
                <article key={site.careerSiteId}>
                  <div>
                    <strong>{site.employerName}</strong>
                    <span>
                      {site.schedulingClass} · priority {String(site.priority)}
                    </span>
                  </div>
                  <span className={`health-pill ${site.healthStatus}`}>
                    {site.healthStatus}
                  </span>
                  <div>
                    <p>{site.reasons.slice(0, 3).join(' · ')}</p>
                    <small className="intelligence-activity">
                      {site.activity.known
                        ? `${String(site.activity.jobsFirstSeen ?? 0)} new jobs · ${String(site.activity.activeJobs ?? 0)} active jobs in the last 30 days`
                        : 'Activity unknown until a linked Source succeeds'}
                    </small>
                  </div>
                  <small>
                    {site.nextEligibleAt === null
                      ? 'No automatic execution'
                      : `Next eligible ${new Date(site.nextEligibleAt).toLocaleString()}`}
                  </small>
                </article>
              ))}
            </div>
            {retiredSites.length > 0 ? (
              <div className="retired-sites">
                <button
                  className="button plain"
                  type="button"
                  onClick={() => setShowRetired((shown) => !shown)}
                  aria-expanded={showRetired}
                >
                  {showRetired ? 'Hide' : 'Show'} retired CareerSites (
                  {String(retiredSites.length)})
                </button>
                {showRetired ? (
                  <div className="discovery-intelligence-sites">
                    {retiredSites.map((site) => (
                      <article key={site.careerSiteId}>
                        <div>
                          <strong>{site.employerName}</strong>
                          <span>
                            {site.schedulingClass} · priority{' '}
                            {String(site.priority)}
                          </span>
                        </div>
                        <span className={`health-pill ${site.healthStatus}`}>
                          {site.healthStatus}
                        </span>
                        <p>{site.reasons.slice(0, 2).join(' · ')}</p>
                        <small>No automatic execution</small>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="discovery-provider-summary">
              {intelligence.data.providers.slice(0, 5).map((provider) => (
                <span key={provider.providerId}>
                  <strong>{provider.providerName}</strong>{' '}
                  {provider.recentSuccessRate === null
                    ? 'No completed-run sample'
                    : `${String(Math.round(provider.recentSuccessRate * 100))}% success`}
                </span>
              ))}
            </div>
          </>
        )}
      </section>
      <div className="source-toolbar">
        <button
          className="button primary"
          type="button"
          onClick={() => setAddingEmployer(true)}
        >
          Add employer
        </button>
      </div>
      {historySummary !== null ? (
        <p className="source-summary" aria-live="polite">
          Verification history: {historySummary}
        </p>
      ) : null}
      <form
        className="employer-form"
        onSubmit={(event) => {
          event.preventDefault();
          importSeedMutation.mutate();
        }}
      >
        <input
          value={seedName}
          onChange={(event) => setSeedName(event.target.value)}
          placeholder="Seed Employer name"
          required
        />
        <input
          type="url"
          value={seedUrl}
          onChange={(event) => setSeedUrl(event.target.value)}
          placeholder="Bounded CareerSite URL"
          required
        />
        <button type="submit" disabled={importSeedMutation.isPending}>
          {importSeedMutation.isPending ? 'Importing…' : 'Import bounded seed'}
        </button>
      </form>

      {addingEmployer ? (
        <form
          className="employer-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleAddEmployer();
          }}
        >
          <input
            type="text"
            placeholder="Employer name"
            value={newEmployerName}
            onChange={(event) => setNewEmployerName(event.target.value)}
            required
          />
          <input
            type="url"
            placeholder="Website URL (optional)"
            value={newEmployerUrl}
            onChange={(event) => setNewEmployerUrl(event.target.value)}
          />
          <button type="submit" disabled={createEmployerMutation.isPending}>
            {createEmployerMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setAddingEmployer(false)}
            disabled={createEmployerMutation.isPending}
          >
            Cancel
          </button>
        </form>
      ) : null}

      {visibleEmployers.length === 0 ? (
        <EmptyState title="No employers registered">
          Add an employer to begin discovery and fingerprinting.
        </EmptyState>
      ) : (
        <div className="employer-list">
          {visibleEmployers.map(({ employer, careerSites }) => (
            <EmployerCard
              key={employer.id}
              employer={employer}
              careerSites={careerSites}
              expanded={expandedEmployerId === employer.id}
              onToggleExpand={() =>
                setExpandedEmployerId(
                  expandedEmployerId === employer.id ? null : employer.id,
                )
              }
              addingSite={addingSiteForEmployer === employer.id}
              newSiteUrl={newSiteUrl}
              onNewSiteUrlChange={setNewSiteUrl}
              onAddSite={() => handleAddSite(employer.id)}
              onStartAddSite={() => setAddingSiteForEmployer(employer.id)}
              onCancelAddSite={() => {
                setAddingSiteForEmployer(null);
                setNewSiteUrl('');
              }}
              onVerify={handleVerify}
              isVerifying={verifyMutation.isPending}
              createSitePending={createSiteMutation.isPending}
              onCreateSource={handleCreateSource}
              creatingSourceForSite={creatingSourceForSite}
              onCheckHealth={(siteId) => healthMutation.mutate(siteId)}
              onRepair={(siteId) => repairMutation.mutate(siteId)}
              isCheckingHealth={
                healthMutation.isPending || repairMutation.isPending
              }
              onShowHistory={(siteId) => historyMutation.mutate(siteId)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{String(value)}</strong>
    </article>
  );
}

function EmployerCard({
  employer,
  careerSites,
  expanded,
  onToggleExpand,
  addingSite,
  newSiteUrl,
  onNewSiteUrlChange,
  onAddSite,
  onStartAddSite,
  onCancelAddSite,
  onVerify,
  isVerifying,
  createSitePending,
  onCreateSource,
  creatingSourceForSite,
  onCheckHealth,
  onRepair,
  isCheckingHealth,
  onShowHistory,
}: {
  employer: EmployerWithSites['employer'];
  careerSites: CareerSiteSummary[];
  expanded: boolean;
  onToggleExpand: () => void;
  addingSite: boolean;
  newSiteUrl: string;
  onNewSiteUrlChange: (value: string) => void;
  onAddSite: () => void;
  onStartAddSite: () => void;
  onCancelAddSite: () => void;
  onVerify: (siteId: string) => void;
  isVerifying: boolean;
  createSitePending: boolean;
  onCreateSource: (siteId: string) => void;
  creatingSourceForSite: string | null;
  onCheckHealth: (siteId: string) => void;
  onRepair: (siteId: string) => void;
  isCheckingHealth: boolean;
  onShowHistory: (siteId: string) => void;
}) {
  const sitesToShow = expanded ? careerSites : careerSites.slice(0, 2);

  return (
    <article className="employer-card">
      <div
        className="employer-card-header"
        style={{ cursor: 'pointer' }}
        onClick={onToggleExpand}
      >
        <h3>{employer.name}</h3>
        {employer.websiteUrl !== null && (
          <p>
            <a
              href={employer.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {employer.websiteUrl}
            </a>
          </p>
        )}
        <span className="career-sites-count">
          {String(careerSites.length)} career site
          {careerSites.length === 1 ? '' : 's'}
        </span>
        <small className="registry-added">
          Added {formatExactDateTime(employer.createdAt)}
        </small>
      </div>
      {expanded ? (
        <div className="career-sites-list">
          {careerSites.map((site) => (
            <CareerSiteRow
              key={site.id}
              site={site}
              onVerify={onVerify}
              isVerifying={isVerifying}
              onCreateSource={onCreateSource}
              creatingSourceForSite={creatingSourceForSite}
              onCheckHealth={onCheckHealth}
              onRepair={onRepair}
              isCheckingHealth={isCheckingHealth}
              onShowHistory={onShowHistory}
            />
          ))}
          {addingSite ? (
            <form
              className="career-site-form"
              onSubmit={(event) => {
                event.preventDefault();
                onAddSite();
              }}
            >
              <input
                type="url"
                placeholder="https://careers.example.com"
                value={newSiteUrl}
                onChange={(event) => onNewSiteUrlChange(event.target.value)}
                required
                disabled={createSitePending}
              />
              <button type="submit" disabled={createSitePending}>
                {createSitePending ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={onCancelAddSite}
                disabled={createSitePending}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              className="button plain"
              type="button"
              onClick={onStartAddSite}
            >
              + Add career site
            </button>
          )}
        </div>
      ) : sitesToShow.length > 0 ? (
        <div className="career-site-preview">
          {sitesToShow.map((site) => (
            <CareerSiteRow
              key={site.id}
              site={site}
              onVerify={onVerify}
              isVerifying={isVerifying}
              onCreateSource={onCreateSource}
              creatingSourceForSite={creatingSourceForSite}
              onCheckHealth={onCheckHealth}
              onRepair={onRepair}
              isCheckingHealth={isCheckingHealth}
              onShowHistory={onShowHistory}
              compact
            />
          ))}
        </div>
      ) : (
        <button className="button plain" type="button" onClick={onStartAddSite}>
          + Add career site
        </button>
      )}
      <button className="button plain" type="button" onClick={onToggleExpand}>
        {expanded ? '▼' : '▶'}
      </button>
    </article>
  );
}

function CareerSiteRow({
  site,
  onVerify,
  isVerifying,
  onCreateSource,
  creatingSourceForSite,
  onCheckHealth,
  onRepair,
  isCheckingHealth,
  onShowHistory,
  compact = false,
}: {
  site: CareerSiteSummary;
  onVerify: (siteId: string) => void;
  isVerifying: boolean;
  onCreateSource: (siteId: string) => void;
  creatingSourceForSite: string | null;
  onCheckHealth: (siteId: string) => void;
  onRepair: (siteId: string) => void;
  isCheckingHealth: boolean;
  onShowHistory: (siteId: string) => void;
  compact?: boolean;
}) {
  const atsPlatform = site.atsPlatform;
  const atsProvider = site.atsDetectedProvider;
  const confidence = Math.round(site.confidence * 100);
  const verificationState = site.verificationState;
  const explanation = site.explanation;
  const discovery = site.discovery;
  const health = site.health;

  const providerLabel = atsProvider ?? atsPlatform ?? 'Unknown';
  const hasMappedProvider = atsProvider !== null;

  return (
    <div className={`career-site-row ${compact ? 'compact' : ''}`}>
      <div>
        <a href={site.url} target="_blank" rel="noopener noreferrer">
          {site.url}
        </a>
        <small className="registry-added">
          Added {formatExactDateTime(site.createdAt)}
        </small>
      </div>
      <div className="career-site-ats">
        <span className={`ats-badge ${atsProvider ?? 'unknown'}`}>
          {providerLabel}
        </span>
        {hasMappedProvider ? (
          <span className="provider-marker">Provider: {atsProvider}</span>
        ) : atsPlatform !== null ? (
          <span className="no-provider-marker">No mapped provider</span>
        ) : (
          <span className="unknown-marker">Unknown ATS</span>
        )}
        <span className="confidence">{confidence}%</span>
      </div>
      <div className="career-site-verification">
        <span className={`verification-badge ${verificationState}`}>
          {verificationState}
        </span>
        {site.lastVerifiedAt !== null ? (
          <time dateTime={site.lastVerifiedAt}>
            {new Date(site.lastVerifiedAt).toLocaleString()}
          </time>
        ) : (
          <span>Never checked</span>
        )}
        {explanation !== null && !compact ? (
          <span className="explanation">{explanation}</span>
        ) : null}
      </div>
      <div className="career-site-discovery">
        <strong>Discovery: {discovery.state}</strong>
        {discovery.sourceId !== null ? (
          <span>Source linked</span>
        ) : (
          <span>No Source linked</span>
        )}
        {discovery.lastResult !== null ? (
          <span>{discovery.lastResult}</span>
        ) : null}
        {discovery.lastAttemptAt !== null ? (
          <time dateTime={discovery.lastAttemptAt}>
            {new Date(discovery.lastAttemptAt).toLocaleString()}
          </time>
        ) : null}
      </div>
      <div className="career-site-health">
        <strong>Health: {health.status}</strong>
        {health.effectiveUrl !== null && health.effectiveUrl !== site.url ? (
          <span>Effective URL: {health.effectiveUrl}</span>
        ) : null}
        {health.message !== null ? <span>{health.message}</span> : null}
        {health.checkedAt !== null ? (
          <time dateTime={health.checkedAt}>
            Checked {new Date(health.checkedAt).toLocaleString()}
          </time>
        ) : (
          <span>Not checked</span>
        )}
        {health.nextCheckAt !== null ? (
          <time dateTime={health.nextCheckAt}>
            Next eligible {new Date(health.nextCheckAt).toLocaleString()}
          </time>
        ) : null}
      </div>
      <button
        className="button plain"
        type="button"
        disabled={isCheckingHealth || health.status === 'retired'}
        onClick={() => onCheckHealth(site.id)}
      >
        {isCheckingHealth ? 'Checking…' : 'Check health'}
      </button>
      <button
        className="button plain"
        type="button"
        disabled={isCheckingHealth || health.status === 'retired'}
        onClick={() => onRepair(site.id)}
      >
        Reverify and repair
      </button>
      <button
        className="button plain"
        type="button"
        onClick={() => onShowHistory(site.id)}
      >
        Show verification history
      </button>
      <button
        className="button plain"
        type="button"
        onClick={() => onVerify(site.id)}
        disabled={isVerifying}
      >
        {isVerifying ? 'Verifying…' : 'Verify'}
      </button>
      {discovery.sourceId === null && health.status !== 'retired' ? (
        <button
          className="button plain"
          type="button"
          onClick={() => onCreateSource(site.id)}
          disabled={creatingSourceForSite === site.id}
        >
          {creatingSourceForSite === site.id
            ? 'Discovering…'
            : 'Discover and run'}
        </button>
      ) : (
        <span className="provider-marker">Discovery Source ready</span>
      )}
    </div>
  );
}
