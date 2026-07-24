// ponytail: the index route is the empty / no-workspace state. It also
// serves as the landing page when the user opens a fresh tab.

import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '../layout';

export const Route = createFileRoute('/')({
  component: IndexRoute,
});

function IndexRoute() {
  return <EmptyState />;
}
