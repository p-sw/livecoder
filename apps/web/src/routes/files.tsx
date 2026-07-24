// ponytail: lazy-load the panel so its deps (lucide-react, ScrollArea)
// load only when the user navigates here. The skeleton keeps the layout
// height stable so the mobile nav doesn't jump.

import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteSpinner } from '../components/RouteSpinner';

const ExplorerPanel = lazy(() =>
  import('../components/ExplorerPanel').then((m) => ({ default: m.ExplorerPanel })),
);

export const Route = createFileRoute('/files')({
  component: FilesRoute,
});

function FilesRoute() {
  return (
    <Suspense fallback={<RouteSpinner />}>
      <ExplorerPanel />
    </Suspense>
  );
}
