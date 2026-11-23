import { Theme } from '@astryxdesign/core/theme';
import { polloV62Theme } from '../../src/themes/pollo-v62/pollo-v62';
import '../../src/themes/pollo-v62/pollo-v62.css';
import '../../src/themes/pollo-v62/tokens.css';
import './components/system/system.css';
/* eslint-disable @lark-apaas/require-app-container -- Pollocloud owns the page shell. */
import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { usePollocloudUser } from '@/hooks/use-pollocloud-user';
import { canManagePollocloudApp } from '@/lib/pollocloud';

import Layout from './components/Layout';
const lazyPage = <T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>, name: string) =>
  React.lazy(async () => {
    const key = `pollo-chunk-retry:${name}`;
    try {
      const page = await load();
      window.sessionStorage.removeItem(key);
      return page;
    } catch (error) {
      if (!window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, '1');
        window.location.reload();
      } else {
        window.sessionStorage.removeItem(key);
      }
      throw error;
    }
  });
const DataPage = lazyPage(() => import('./pages/DataPage/DataPage'), 'data');
const OverviewPage = lazyPage(() => import('./pages/OverviewPage/OverviewPage'), 'overview');
const ChainPage = lazyPage(() => import('./pages/ChainPage/ChainPage'), 'chain');
const PaymentPage = lazyPage(() => import('./pages/PaymentPage/PaymentPage'), 'payment');
const CreativePage = lazyPage(() => import('./pages/CreativePage/CreativePage'), 'creative');
const AdsPage = lazyPage(() => import('./pages/AdsPage/AdsPage'), 'ads');
const DetailsPage = lazyPage(() => import('./pages/DetailsPage/DetailsPage'), 'details');
import { dashboardView } from './components/dashboard/navigation';

function DashboardRoute() {
  const location = useLocation();
  const view = dashboardView(location.pathname, location.search).id;
  return view === 'trend' ? (
    <OverviewPage />
  ) : view === 'chain' ? (
    <ChainPage />
  ) : view === 'payment' ? (
    <PaymentPage />
  ) : view === 'creative' ? (
    <CreativePage />
  ) : view === 'ads' ? (
    <AdsPage />
  ) : view === 'details' ? (
    <DetailsPage />
  ) : (
    <DataPage />
  );
}
import NotFound from './pages/NotFound/NotFound';

const ReportPage = lazyPage(() => import('./pages/ReportPage/ReportPage'), 'report');
const AdminManagementPage = lazyPage(() => import('./pages/AdminManagementPage/AdminManagementPage'), 'admin');
const PermissionsPage = lazyPage(() => import('./pages/PermissionsPage/PermissionsPage'), 'permissions');

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
    <Theme theme={polloV62Theme} mode="light">
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardRoute />} />
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
    </Theme>
  );
};

export default RoutesComponent;
