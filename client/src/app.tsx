/* eslint-disable @lark-apaas/require-app-container -- Pollocloud owns the page shell. */
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';

import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage/DashboardPage';
import NotFound from './pages/NotFound/NotFound';

const ReportPage = React.lazy(() => import('./pages/ReportPage/ReportPage'));
const AdminManagementPage = React.lazy(() => import('./pages/AdminManagementPage/AdminManagementPage'));
const PermissionsPage = React.lazy(() => import('./pages/PermissionsPage/PermissionsPage'));

if (new URLSearchParams(location.search).has('perf')) {
  void import('./lib/dashboard-performance');
}

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = usePollocloudUser();
  if (window.location.hostname.endsWith('.pollocloud.com')) {
    return <Navigate to="/permissions" replace />;
  }
  if (loading) {
    return <div className="px-8 py-12 text-sm text-muted-foreground">正在验证权限...</div>;
  }
  if (!canManagePollocloudApp(user)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="permissions" element={<PermissionsPage />} />
        <Route
          path="admin"
          element={
            <AdminRoute>
              <AdminManagementPage />
            </AdminRoute>
          }
        />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
