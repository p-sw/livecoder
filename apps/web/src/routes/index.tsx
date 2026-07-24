// ponytail: the index route is the empty / no-workspace state. It also
// serves as the landing page when the user opens a fresh tab.

import { createFileRoute, Navigate } from '@tanstack/react-router';
import { EmptyState } from '../layout';
import { useWorkspaceStore } from '../workspace-context';
import { routeWithWorkspace } from '../router';


export const Route = createFileRoute('/')({
  component: IndexRoute,
});

function IndexRoute() {
  const { workspace } = useWorkspaceStore();
  return workspace ? <Navigate to={routeWithWorkspace('/files', workspace.path)} replace /> : <EmptyState />;
}
