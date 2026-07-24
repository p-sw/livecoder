// ponytail: thin wrapper. The git source-control UI lives in GitPanel.
// The route file gives the URL a navigable name.

import { createFileRoute } from '@tanstack/react-router';
import { GitPanel } from '../components/GitPanel';

export const Route = createFileRoute('/git')({
  component: GitRoute,
});

function GitRoute() {
  return <GitPanel />;
}
