import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';


import RoutesComponent from './app.tsx';
import './index.css';
import { createPortal } from 'react-dom';
import { Toaster } from '@client/src/components/ui/sonner';

function resolveClientBasePath(): string {
  const appPathMatch = window.location.pathname.match(/^\/app\/[^/]+/u);
  if (appPathMatch) return appPathMatch[0];
  return import.meta.env.VITE_CLIENT_BASE_PATH || '/';
}

const CLIENT_BASE_PATH = resolveClientBasePath();

const MainApp = () => {
  return (
    <BrowserRouter basename={CLIENT_BASE_PATH}>
      <ErrorBoundary
        fallbackRender={({ error, resetErrorBoundary }) => (
          <main className="grid min-h-screen place-items-center bg-background p-8 text-center">
            <div>
              <h1 className="text-xl font-semibold text-foreground">页面暂时无法加载</h1>
              <p className="mt-2 text-sm text-muted-foreground">{String(error)}</p>
              <button type="button" className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={resetErrorBoundary}>重新加载</button>
            </div>
          </main>
        )}
      >
        <RoutesComponent />
        {createPortal(<Toaster />, document.body)}
      </ErrorBoundary>
    </BrowserRouter>
  );
};

createRoot(document.getElementById('root')!).render(<MainApp />);
