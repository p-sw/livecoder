// ponytail: lazy-load the Git panel so the heaviest icon set + dialog
// code only ships when the user opens the source-control view.

import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteSpinner } from '../components/RouteSpinner';

const GitPanel = lazy(() =>
  import('../components/GitPanel').then((m) => ({ default: m.GitPanel })),
);

export const Route = createFileRoute('/git')({
  component: GitRoute,
});

function GitRoute() {
  return (
    <Suspense fallback={<RouteSpinner />}>
      <GitPanel />
    </Suspense>
  );
}
