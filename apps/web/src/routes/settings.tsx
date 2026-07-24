// ponytail: lazy-load the settings panel. It pulls in lucide-react icons
// and the api helpers; cheaper to fetch on first navigation.

import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteSpinner } from '../components/RouteSpinner';

const SettingsPanel = lazy(() =>
  import('../components/SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);

export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
});

function SettingsRoute() {
  return (
    <Suspense fallback={<RouteSpinner />}>
      <SettingsPanel />
    </Suspense>
  );
}
