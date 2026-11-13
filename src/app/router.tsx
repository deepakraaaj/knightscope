import { lazy, Suspense, type ComponentType } from 'react';
import { createHashRouter, useRouteError } from 'react-router-dom';
import { Shell } from '@/components/layout/Shell';
import { Spinner } from '@/components/ui';

function page(load: () => Promise<Record<string, ComponentType>>, name: string) {
  const C = lazy(async () => ({ default: (await load())[name] }));
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Spinner label="Loading…" /></div>}>
      <C />
    </Suspense>
  );
}

function RouteError() {
  const err = useRouteError() as (Error & { statusText?: string }) | undefined;
  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">Page not available</h1>
      <p className="mt-2 text-sm text-muted">{err?.message ?? err?.statusText ?? 'This page does not exist.'}</p>
      <a href="#/" className="mt-4 inline-block text-sm text-primary">Back to dashboard</a>
    </div>
  );
}

// Hash routing works on every static host and inside the native app without server rewrites.
export const router = createHashRouter([
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage') },
      { path: '/import', element: page(() => import('@/features/import/ImportPage'), 'ImportPage') },
      { path: '/games', element: page(() => import('@/features/review/GamesPage'), 'GamesPage') },
      { path: '/review/:gameId', element: page(() => import('@/features/review/ReviewPage'), 'ReviewPage') },
      { path: '/analysis', element: page(() => import('@/features/analysis/AnalysisBoardPage'), 'AnalysisBoardPage') },
      { path: '/mistakes', element: page(() => import('@/features/mistake-memory/MistakeMemoryPage'), 'MistakeMemoryPage') },
      { path: '/training', element: page(() => import('@/features/training/TrainingPage'), 'TrainingPage') },
      { path: '/analytics', element: page(() => import('@/features/analytics/AnalyticsPage'), 'AnalyticsPage') },
      { path: '/settings', element: page(() => import('@/features/settings/SettingsPage'), 'SettingsPage') },
      { path: '*', element: <RouteError /> },
    ],
  },
]);
