import type { ReactNode } from 'react';

export function LoadingState({
  label = 'Loading workspace',
}: {
  label?: string;
}) {
  return (
    <div className="state-card" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function ErrorState({
  error,
  title = 'Unable to load data',
}: {
  error: unknown;
  title?: string;
}) {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred.';
  return (
    <div className="state-card error-state" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="state-card empty-state">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}
