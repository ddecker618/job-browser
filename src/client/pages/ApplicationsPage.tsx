import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from '../../domain/application-status.js';
import type { ApplicationListQuery } from '../../models/application-management.js';
import { api } from '../api.js';
import {
  applicationStatusLabel,
  formatOccurrence,
  formatRecordedAt,
} from '../applicationFormatting.js';
import { PageHeader } from '../components/PageHeader.js';
import { EmptyState, ErrorState, LoadingState } from '../components/States.js';

const pageSizes = [25, 50, 100] as const;

export function ApplicationsPage() {
  const [status, setStatus] = useState<ApplicationStatus | ''>('');
  const [company, setCompany] = useState('');
  const [limit, setLimit] = useState<number>(25);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([]);

  const query: ApplicationListQuery = {
    limit,
    ...(status === '' ? {} : { status }),
    ...(company.trim() === '' ? {} : { company: company.trim() }),
    ...(cursor === null ? {} : { cursor }),
  };
  const applications = useQuery({
    queryKey: ['applications', 'list', query],
    queryFn: ({ signal }) => api.listApplications(query, signal),
    placeholderData: (previous) => previous,
  });

  const resetPagination = () => {
    setCursor(null);
    setCursorHistory([]);
  };

  return (
    <>
      <PageHeader
        eyebrow="Application workspace"
        title="Applications"
        description="Review copied application context and the immutable event ledger."
      />
      <section className="application-filters" aria-label="Application filters">
        <label>
          Current status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ApplicationStatus | '');
              resetPagination();
            }}
          >
            <option value="">All current statuses</option>
            {APPLICATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {applicationStatusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Company (exact)
          <input
            value={company}
            onChange={(event) => {
              setCompany(event.target.value);
              resetPagination();
            }}
            placeholder="Exact copied Company text"
          />
        </label>
        <label>
          Rows per page
          <select
            value={limit}
            onChange={(event) => {
              setLimit(Number(event.target.value));
              resetPagination();
            }}
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </section>

      {applications.isPending ? (
        <LoadingState label="Loading applications" />
      ) : applications.isError ? (
        <ErrorState
          error={applications.error}
          title="Applications unavailable"
        />
      ) : applications.data.items.length === 0 ? (
        <EmptyState title="No applications found">
          No current Application records match these filters.
        </EmptyState>
      ) : (
        <>
          {applications.isFetching ? (
            <p className="applications-updating" role="status">
              Updating applications…
            </p>
          ) : null}
          <div className="table-wrap applications-table-wrap">
            <table className="applications-table">
              <caption className="visually-hidden">
                Applications ordered by recent recorded activity
              </caption>
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">Company</th>
                  <th scope="col">Current status</th>
                  <th scope="col">Applied</th>
                  <th scope="col">Recent recorded activity</th>
                </tr>
              </thead>
              <tbody>
                {applications.data.items.map((application) => {
                  const title = application.titleAtApplication ?? 'Unknown';
                  return (
                    <tr key={application.id}>
                      <td data-label="Role">
                        <Link
                          to={`/applications/${encodeURIComponent(
                            application.id,
                          )}`}
                        >
                          {title}
                        </Link>
                      </td>
                      <td data-label="Company">
                        {application.companyAtApplication ?? 'Unknown'}
                      </td>
                      <td data-label="Current status">
                        <span className="application-state-label">
                          {applicationStatusLabel(application.status)}
                        </span>
                      </td>
                      <td data-label="Applied">
                        {formatOccurrence(
                          application.appliedAt,
                          application.appliedAtPrecision,
                        )}
                      </td>
                      <td data-label="Recent recorded activity">
                        {formatRecordedAt(application.lastRecordedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <nav className="pagination" aria-label="Application pages">
        <button
          type="button"
          disabled={cursorHistory.length === 0 || applications.isFetching}
          onClick={() => {
            setCursorHistory((history) => {
              const previous = history[history.length - 1] ?? null;
              setCursor(previous);
              return history.slice(0, -1);
            });
          }}
        >
          Previous
        </button>
        <span>Page {String(cursorHistory.length + 1)}</span>
        <button
          type="button"
          disabled={
            applications.data?.nextCursor == null || applications.isFetching
          }
          onClick={() => {
            const nextCursor = applications.data?.nextCursor;
            if (nextCursor == null) return;
            setCursorHistory((history) => [...history, cursor]);
            setCursor(nextCursor);
          }}
        >
          Next
        </button>
      </nav>
    </>
  );
}
