import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useSearchParams } from 'react-router';

import type { JobSearchQuery } from '../../models/job-search.js';
import { api } from '../api.js';
import { JobDetailPanel } from '../components/JobDetailPanel.js';
import { PageHeader } from '../components/PageHeader.js';
import { EmptyState, ErrorState, LoadingState } from '../components/States.js';
import { SCORING_RULES_VERSION } from '../../intelligence/scoringVersion.js';

interface Filters {
  q: string;
  company: string;
  location: string;
  remoteType: string;
  provider: string;
  sourceId: string;
  minScore: string;
  maxScore: string;
  minSalary: string;
  recommendation: string;
  status: string;
  matchedFamilies: string;
  verificationStatus: string;
  firstDiscoveredFrom: string;
  firstDiscoveredTo: string;
  lastVerifiedFrom: string;
  lastVerifiedTo: string;
  newlyDiscovered: string;
  materiallyUpdated: string;
  closingSoon: string;
  active: string;
  multipleSource: string;
}

const initialFilters: Filters = {
  q: '',
  company: '',
  location: '',
  remoteType: '',
  provider: '',
  sourceId: '',
  minScore: '',
  maxScore: '',
  minSalary: '',
  recommendation: '',
  status: '',
  matchedFamilies: '',
  verificationStatus: '',
  firstDiscoveredFrom: '',
  firstDiscoveredTo: '',
  lastVerifiedFrom: '',
  lastVerifiedTo: '',
  newlyDiscovered: '',
  materiallyUpdated: '',
  closingSoon: '',
  active: '',
  multipleSource: '',
};
const filterKeys = Object.keys(initialFilters) as (keyof Filters)[];
const pageSize = 100;
const FILTER_STORAGE_KEY = `job-browser-filters:${SCORING_RULES_VERSION}`;

export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const storedFilters = useRef(loadFilters());
  const hasUrlFilters = filterKeys.some((key) => searchParams.has(key));
  const filters = readFilters(
    searchParams,
    hasUrlFilters ? initialFilters : storedFilters.current,
  );
  const deferredSearch = useDeferredValue(filters.q);
  const page = positiveInteger(searchParams.get('page')) ?? 1;
  const sort = readSort(searchParams.get('sort'));
  const selectedJob = searchParams.get('job');
  const [showFilters, setShowFilters] = useState(false);
  const client = useQueryClient();
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );

  useEffect(() => {
    if (hasUrlFilters || !hasFilters(storedFilters.current)) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        writeFilters(next, storedFilters.current);
        return next;
      },
      { replace: true },
    );
  }, [hasUrlFilters, setSearchParams]);

  const serializedFilters = JSON.stringify(filters);
  useEffect(() => {
    localStorage.setItem(FILTER_STORAGE_KEY, serializedFilters);
  }, [serializedFilters]);

  const query: Partial<JobSearchQuery> = {
    page,
    pageSize,
    sort,
    direction: sort === 'company' || sort === 'title' ? 'asc' : 'desc',
    ...(deferredSearch === '' ? {} : { q: deferredSearch }),
    ...(filters.company === '' ? {} : { company: filters.company }),
    ...(filters.location === '' ? {} : { location: filters.location }),
    ...(filters.remoteType === ''
      ? {}
      : { remoteType: filters.remoteType as JobSearchQuery['remoteType'] }),
    ...(filters.provider === '' ? {} : { provider: filters.provider }),
    ...(filters.sourceId === '' ? {} : { sourceId: filters.sourceId }),
    ...numberQuery('minScore', filters.minScore),
    ...numberQuery('maxScore', filters.maxScore),
    ...numberQuery('minSalary', filters.minSalary),
    ...(filters.recommendation === ''
      ? {}
      : { recommendation: filters.recommendation }),
    ...(filters.status === ''
      ? {}
      : { status: filters.status as JobSearchQuery['status'] }),
    ...(filters.matchedFamilies === ''
      ? {}
      : { matchedFamilies: filters.matchedFamilies }),
    ...(filters.verificationStatus === ''
      ? {}
      : { verificationStatus: filters.verificationStatus }),
    ...textQuery('firstDiscoveredFrom', filters.firstDiscoveredFrom),
    ...textQuery('firstDiscoveredTo', filters.firstDiscoveredTo),
    ...textQuery('lastVerifiedFrom', filters.lastVerifiedFrom),
    ...textQuery('lastVerifiedTo', filters.lastVerifiedTo),
    ...booleanQuery('newlyDiscovered', filters.newlyDiscovered),
    ...booleanQuery('materiallyUpdated', filters.materiallyUpdated),
    ...booleanQuery('closingSoon', filters.closingSoon),
    ...(filters.active === ''
      ? {}
      : { active: filters.active as JobSearchQuery['active'] }),
    ...booleanQuery('multipleSource', filters.multipleSource),
  };
  const jobs = useQuery({
    queryKey: ['jobs', 'search', query],
    queryFn: ({ signal }) => api.searchJobs(query, signal),
    placeholderData: (previous) => previous,
  });
  const savedFilters = useQuery({
    queryKey: ['saved-filters'],
    queryFn: api.savedFilters,
  });
  const saveFilter = useMutation({
    mutationFn: (name: string) => api.saveFilter(name, { ...filters }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['saved-filters'] }),
  });
  const rows = jobs.data?.items ?? [];
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 62,
    overscan: 8,
    initialRect: { width: 1250, height: 620 },
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const renderedRows = virtualRows.some(
    (virtualRow) => rows[virtualRow.index] !== undefined,
  )
    ? virtualRows
    : rows.slice(0, 20).map((_, index) => ({
        index,
        start: index * 62,
        end: (index + 1) * 62,
      }));
  const topPadding = renderedRows[0]?.start ?? 0;
  const bottomPadding =
    rowVirtualizer.getTotalSize() -
    (renderedRows[renderedRows.length - 1]?.end ?? 0);

  const updateFilter = (key: keyof Filters, value: string, replace = false) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === '') next.delete(key);
        else next.set(key, value);
        next.delete('page');
        return next;
      },
      { replace },
    );
  };
  const selectJob = (id: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id === null) next.delete('job');
      else next.set('job', id);
      return next;
    });
  };

  if (jobs.isPending) return <LoadingState label="Loading job inventory" />;
  if (jobs.isError)
    return <ErrorState error={jobs.error} title="Jobs unavailable" />;
  const facets = jobs.data.facets;
  const pages = jobs.data.pages;

  return (
    <>
      <PageHeader
        eyebrow="Opportunity inventory"
        title="Jobs"
        description={`${String(jobs.data.total)} roles match the current view.`}
        actions={
          <>
            <button
              className="button"
              onClick={() => setShowFilters((value) => !value)}
            >
              Filters
            </button>
            <select
              aria-label="Sort jobs"
              value={sort}
              onChange={(event) => {
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('sort', event.target.value);
                  next.delete('page');
                  return next;
                });
              }}
            >
              <option value="score">Highest score</option>
              <option value="firstSeenAt">Newest first</option>
              <option value="lastVerifiedAt">Recently verified</option>
              <option value="closingDate">Closing date</option>
              <option value="materiallyUpdatedAt">Recently updated</option>
              <option value="company">Company</option>
              <option value="title">Title</option>
            </select>
          </>
        }
      />
      <div className="jobs-toolbar">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search jobs"
            value={filters.q}
            onChange={(event) => updateFilter('q', event.target.value, true)}
            placeholder="Search title, company, or job content"
          />
        </label>
        <div className="saved-filter-row">
          {savedFilters.data?.map((filter) => (
            <button
              key={filter.id}
              onClick={() => {
                const restored = normalizeSavedFilters(filter.filters);
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  for (const key of filterKeys) next.delete(key);
                  next.delete('page');
                  writeFilters(next, restored);
                  return next;
                });
              }}
            >
              {filter.name}
            </button>
          ))}
          <button
            onClick={() => {
              const name = window.prompt('Saved filter name');
              if (name) saveFilter.mutate(name);
            }}
          >
            + Save view
          </button>
        </div>
      </div>
      {showFilters ? (
        <section className="filter-panel" aria-label="Job filters">
          <FacetSelect
            label="Company"
            value={filters.company}
            options={facets.companies}
            onChange={(value) => updateFilter('company', value)}
          />
          <FacetSelect
            label="Location"
            value={filters.location}
            options={facets.locations}
            onChange={(value) => updateFilter('location', value)}
          />
          <FacetSelect
            label="Remote type"
            value={filters.remoteType}
            options={facets.remoteTypes}
            onChange={(value) => updateFilter('remoteType', value)}
          />
          <FacetSelect
            label="Provider"
            value={filters.provider}
            options={facets.providers}
            onChange={(value) => updateFilter('provider', value)}
          />
          <FacetSelect
            label="Source"
            value={filters.sourceId}
            options={facets.sources}
            onChange={(value) => updateFilter('sourceId', value)}
          />
          <NumberFilter
            label="Minimum score"
            value={filters.minScore}
            max={100}
            onChange={(value) => updateFilter('minScore', value)}
          />
          <NumberFilter
            label="Maximum score"
            value={filters.maxScore}
            max={100}
            onChange={(value) => updateFilter('maxScore', value)}
          />
          <NumberFilter
            label="Minimum salary"
            value={filters.minSalary}
            onChange={(value) => updateFilter('minSalary', value)}
          />
          <FacetSelect
            label="Recommendation"
            value={filters.recommendation}
            options={facets.recommendations}
            onChange={(value) => updateFilter('recommendation', value)}
          />
          <FacetSelect
            label="Status"
            value={filters.status}
            options={facets.statuses}
            onChange={(value) => updateFilter('status', value)}
          />
          <label>
            Role family
            <input
              value={filters.matchedFamilies}
              placeholder="e.g. systems, network"
              onChange={(event) =>
                updateFilter('matchedFamilies', event.target.value)
              }
            />
          </label>
          <FacetSelect
            label="Verification"
            value={filters.verificationStatus}
            options={[
              { value: 'verified', label: 'Verified', count: 0 },
              { value: 'unverified', label: 'Unverified', count: 0 },
              { value: 'closed', label: 'Closed', count: 0 },
            ]}
            onChange={(value) => updateFilter('verificationStatus', value)}
          />
          <DateFilter
            label="First discovered from"
            value={filters.firstDiscoveredFrom}
            onChange={(value) => updateFilter('firstDiscoveredFrom', value)}
          />
          <DateFilter
            label="First discovered to"
            value={filters.firstDiscoveredTo}
            onChange={(value) => updateFilter('firstDiscoveredTo', value)}
          />
          <DateFilter
            label="Last verified from"
            value={filters.lastVerifiedFrom}
            onChange={(value) => updateFilter('lastVerifiedFrom', value)}
          />
          <DateFilter
            label="Last verified to"
            value={filters.lastVerifiedTo}
            onChange={(value) => updateFilter('lastVerifiedTo', value)}
          />
          <BooleanFilter
            label="Newly discovered"
            value={filters.newlyDiscovered}
            onChange={(value) => updateFilter('newlyDiscovered', value)}
          />
          <BooleanFilter
            label="Materially updated"
            value={filters.materiallyUpdated}
            onChange={(value) => updateFilter('materiallyUpdated', value)}
          />
          <BooleanFilter
            label="Closing soon"
            value={filters.closingSoon}
            onChange={(value) => updateFilter('closingSoon', value)}
          />
          <FacetSelect
            label="Active state"
            value={filters.active}
            options={facets.activeStates}
            onChange={(value) => updateFilter('active', value)}
          />
          <BooleanFilter
            label="Multiple sources"
            value={filters.multipleSource}
            onChange={(value) => updateFilter('multipleSource', value)}
          />
          <button
            className="text-button"
            onClick={() => {
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                for (const key of filterKeys) next.delete(key);
                next.delete('page');
                return next;
              });
              storedFilters.current = initialFilters;
            }}
          >
            Clear all
          </button>
        </section>
      ) : null}
      {jobs.isFetching ? (
        <p className="jobs-updating">Updating results…</p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="No jobs found">
          Adjust filters or run discovery to populate this view.
        </EmptyState>
      ) : (
        <div className="table-wrap jobs-table-scroll" ref={setScrollElement}>
          <table className="jobs-table">
            <thead>
              <tr>
                <ResizableHeader label="Role" width={310} />
                <ResizableHeader label="Company" width={190} />
                <ResizableHeader label="Location" width={170} />
                <ResizableHeader label="Score" width={80} />
                <ResizableHeader label="Recommendation" width={160} />
                <ResizableHeader label="Status" width={105} />
                <ResizableHeader label="Sources" width={230} />
                <ResizableHeader label="Lifecycle" width={170} />
              </tr>
            </thead>
            <tbody>
              {topPadding > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={8} style={{ height: topPadding, padding: 0 }} />
                </tr>
              ) : null}
              {renderedRows.map((virtualRow) => {
                const job = rows[virtualRow.index];
                if (job === undefined) return null;
                return (
                  <tr
                    key={job.id}
                    tabIndex={0}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    onClick={() => selectJob(job.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectJob(job.id);
                      }
                    }}
                  >
                    <td>
                      <strong>
                        {job.favorite ? '★ ' : ''}
                        {job.title}
                      </strong>
                      <span className="family-badges">
                        {job.matchedFamilies?.split(',').map((family) => (
                          <span
                            key={family}
                            className={`family-badge family-${family}`}
                          >
                            {family}
                          </span>
                        ))}
                      </span>
                      <small>{job.remoteType}</small>
                    </td>
                    <td>{job.company}</td>
                    <td>{job.location ?? 'Not listed'}</td>
                    <td>
                      <span
                        className={`score-chip score-${scoreBand(job.score)}`}
                      >
                        {job.score?.toFixed(1) ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span className="recommendation-cell">
                        {job.recommendation ?? 'Unscored'}
                        {job.verificationStatus === 'verified' &&
                        job.eligibilityPassed ? (
                          <span
                            className="verified-badge"
                            title="Verified eligible match"
                          >
                            ✓
                          </span>
                        ) : job.eligibilityPassed === false ? (
                          <span
                            className="ineligible-badge"
                            title={job.eligibilityRejection ?? 'Ineligible'}
                          >
                            Ineligible
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill status-${job.status}`}>
                        {job.status}
                      </span>
                    </td>
                    <td>
                      <span
                        className="source-memberships"
                        title={job.sources
                          .map(
                            (source) =>
                              `${source.sourceName} (${source.providerId ?? 'provider unknown'})`,
                          )
                          .join(', ')}
                      >
                        {job.sources.length === 0
                          ? 'No source'
                          : job.sources
                              .map(
                                (source) =>
                                  `${source.sourceName} · ${source.providerId ?? 'unknown'}`,
                              )
                              .join(' / ')}
                      </span>
                    </td>
                    <td>
                      <span className="lifecycle-indicators">
                        {isNew(job.firstSeenAt) ? <i>New</i> : null}
                        {job.materiallyUpdatedAt === null ? null : (
                          <i>Updated</i>
                        )}
                        {isClosingSoon(job.closingDate) ? (
                          <i>Closing soon</i>
                        ) : null}
                        {job.active ? null : <i className="removed">Removed</i>}
                      </span>
                      <small>{formatDate(job.firstSeenAt)}</small>
                    </td>
                  </tr>
                );
              })}
              {bottomPadding > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={8}
                    style={{ height: bottomPadding, padding: 0 }}
                  />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination">
        <button
          disabled={page <= 1}
          onClick={() => setPageParameter(setSearchParams, page - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {Math.max(1, pages)}
        </span>
        <button
          disabled={pages === 0 || page >= pages}
          onClick={() => setPageParameter(setSearchParams, page + 1)}
        >
          Next
        </button>
      </div>
      {selectedJob === null ? null : (
        <JobDetailPanel jobId={selectedJob} onClose={() => selectJob(null)} />
      )}
    </>
  );
}

type SetSearchParams = ReturnType<typeof useSearchParams>[1];

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; count: number }[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberFilter({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: string;
  max?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function DateFilter(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <input
        type="date"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function BooleanFilter(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">Either</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </label>
  );
}

function ResizableHeader({ label, width }: { label: string; width: number }) {
  const [currentWidth, setCurrentWidth] = useState(width);
  return (
    <th style={{ width: currentWidth, minWidth: currentWidth }}>
      <span>{label}</span>
      <button
        className="column-resizer"
        aria-label={`Resize ${label} column`}
        onPointerDown={(event) => {
          const start = event.clientX;
          const original = currentWidth;
          const move = (moveEvent: PointerEvent) =>
            setCurrentWidth(Math.max(70, original + moveEvent.clientX - start));
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
    </th>
  );
}

function readFilters(parameters: URLSearchParams, fallback: Filters): Filters {
  return Object.fromEntries(
    filterKeys.map((key) => [key, parameters.get(key) ?? fallback[key]]),
  ) as unknown as Filters;
}

function loadFilters(): Filters {
  try {
    const saved = JSON.parse(
      localStorage.getItem(FILTER_STORAGE_KEY) ?? '{}',
    ) as Record<string, unknown>;
    return normalizeSavedFilters(saved);
  } catch {
    return initialFilters;
  }
}

function normalizeSavedFilters(saved: Record<string, unknown>): Filters {
  const normalized = { ...initialFilters };
  for (const key of filterKeys) {
    const value = saved[key];
    if (typeof value === 'string') normalized[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean')
      normalized[key] = String(value);
  }
  if (normalized.q === '' && typeof saved['search'] === 'string')
    normalized.q = saved['search'];
  if (normalized.remoteType === '' && typeof saved['remote'] === 'string')
    normalized.remoteType = saved['remote'];
  if (normalized.minSalary === '' && typeof saved['salary'] === 'number')
    normalized.minSalary = saved['salary'] === 0 ? '' : String(saved['salary']);
  if (
    normalized.firstDiscoveredFrom === '' &&
    typeof saved['date'] === 'string'
  )
    normalized.firstDiscoveredFrom = saved['date'];
  return normalized;
}

function writeFilters(parameters: URLSearchParams, filters: Filters): void {
  for (const key of filterKeys) {
    if (filters[key] !== '') parameters.set(key, filters[key]);
  }
}

function hasFilters(filters: Filters): boolean {
  return filterKeys.some((key) => filters[key] !== '');
}

function numberQuery(
  key: 'minScore' | 'maxScore' | 'minSalary',
  value: string,
): Partial<JobSearchQuery> {
  if (value === '') return {};
  const parsed = Number(value);
  return Number.isFinite(parsed) ? { [key]: parsed } : {};
}

function textQuery(
  key:
    | 'firstDiscoveredFrom'
    | 'firstDiscoveredTo'
    | 'lastVerifiedFrom'
    | 'lastVerifiedTo',
  value: string,
): Partial<JobSearchQuery> {
  return value === '' ? {} : { [key]: value };
}

function booleanQuery(
  key:
    | 'newlyDiscovered'
    | 'materiallyUpdated'
    | 'closingSoon'
    | 'multipleSource',
  value: string,
): Partial<JobSearchQuery> {
  return value === '' ? {} : { [key]: value === 'true' };
}

function readSort(value: string | null): JobSearchQuery['sort'] {
  const allowed: JobSearchQuery['sort'][] = [
    'score',
    'firstSeenAt',
    'lastVerifiedAt',
    'closingDate',
    'company',
    'title',
    'materiallyUpdatedAt',
  ];
  return allowed.find((candidate) => candidate === value) ?? 'score';
}

function positiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

function setPageParameter(setter: SetSearchParams, page: number): void {
  setter((current) => {
    const next = new URLSearchParams(current);
    if (page <= 1) next.delete('page');
    else next.set('page', String(page));
    return next;
  });
}

function scoreBand(score: number | null): string {
  if (score === null) return 'none';
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

function isNew(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    timestamp >= Date.now() - 7 * 24 * 60 * 60 * 1000
  );
}

function isClosingSoon(value: string | null): boolean {
  if (value === null) return false;
  const timestamp = Date.parse(value);
  const now = Date.now();
  return (
    Number.isFinite(timestamp) &&
    timestamp >= now &&
    timestamp < now + 14 * 24 * 60 * 60 * 1000
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}
