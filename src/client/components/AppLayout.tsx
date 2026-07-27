import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { desktopBridge } from '../desktop.js';
import { api } from '../api.js';
import { NotificationManager } from './NotificationManager.js';

const navigation = [
  ['/', 'Dashboard', 'DB'],
  ['/jobs', 'Jobs', 'JB'],
  ['/profile', 'Profile', 'PR'],
  ['/resumes', 'Resumes', 'RS'],
  ['/analytics', 'Analytics', 'AN'],
  ['/sources', 'Sources', 'SO'],
  ['/settings', 'Settings', 'ST'],
] as const;

export function AppLayout() {
  const location = useLocation();
  const current = navigation.find(([path]) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(path),
  );
  const [runtime, setRuntime] = useState('Local database');
  const discovery = useQuery({
    queryKey: ['source-control-center'],
    queryFn: api.sourceControlCenter,
    refetchInterval: 15_000,
  });
  const discoverySummary = discovery.data?.summary;
  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge !== null) {
      void bridge
        .getRuntimeInfo()
        .then((info) =>
          setRuntime(`Desktop ${info.version} · ${info.backendStatus}`),
        );
    }
  }, []);

  return (
    <div className="app-shell">
      <NotificationManager />
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark">JB</span>
          <span>Job Browser</span>
        </div>
        <nav>
          {navigation.map(([path, label, icon]) => (
            <NavLink key={path} to={path} end={path === '/'}>
              <span className="nav-icon" aria-hidden="true">
                {icon}
              </span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-status">
          <span
            className={`status-dot ${discoverySummary?.failedSources ? 'failed' : ''}`}
          />
          {discovery.data?.discovery?.running === true
            ? 'Discovery running'
            : discoverySummary?.failedSources
              ? `${String(discoverySummary.failedSources)} source failure${discoverySummary.failedSources === 1 ? '' : 's'}`
              : discoverySummary?.nextScheduledRun
                ? `Next ${new Date(discoverySummary.nextScheduledRun).toLocaleString()}`
                : runtime}
        </div>
      </aside>
      <div className="content-shell">
        <header className="topbar">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>{current?.[1] ?? 'Job Browser'}</h1>
          </div>
          <div className="topbar-actions">
            <kbd>/</kbd>
            <span>Quick search</span>
            <div className="avatar" aria-label="Dustin Decker profile">
              DD
            </div>
          </div>
        </header>
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
