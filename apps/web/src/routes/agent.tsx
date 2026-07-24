// ponytail: lazy-load the chat panel so its icons + adapter picker
// only ship when the user opens the agent.

import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteSpinner } from '../components/RouteSpinner';

const AgentPanel = lazy(() =>
  import('../components/AgentPanel').then((m) => ({ default: m.AgentPanel })),
);

export const Route = createFileRoute('/agent')({
  component: AgentRoute,
});

function AgentRoute() {
  return (
    <Suspense fallback={<RouteSpinner />}>
      <AgentPanel />
    </Suspense>
  );
}
