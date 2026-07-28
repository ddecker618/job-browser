import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/AppLayout.js';
import { LoadingState } from './components/States.js';

const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage.js').then((module) => ({
    default: module.AnalyticsPage,
  })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.js').then((module) => ({
    default: module.DashboardPage,
  })),
);
const JobsPage = lazy(() =>
  import('./pages/JobsPage.js').then((module) => ({
    default: module.JobsPage,
  })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage.js').then((module) => ({
    default: module.ProfilePage,
  })),
);
const ResumesPage = lazy(() =>
  import('./pages/ResumesPage.js').then((module) => ({
    default: module.ResumesPage,
  })),
);
const SearchProfilePage = lazy(() =>
  import('./pages/SearchProfilePage.js').then((module) => ({
    default: module.SearchProfilePage,
  })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage.js').then((module) => ({
    default: module.SettingsPage,
  })),
);
const SourcesPage = lazy(() =>
  import('./pages/SourcesPage.js').then((module) => ({
    default: module.SourcesPage,
  })),
);

export function App() {
  return (
    <Suspense fallback={<LoadingState label="Loading page" />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="resumes" element={<ResumesPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="search-profile" element={<SearchProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
