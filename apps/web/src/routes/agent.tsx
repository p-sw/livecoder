// ponytail: thin wrapper. The chat UI lives in AgentPanel; the route
// file just gives the URL a name.

import { createFileRoute } from '@tanstack/react-router';
import { AgentPanel } from '../components/AgentPanel';

export const Route = createFileRoute('/agent')({
  component: AgentRoute,
});

function AgentRoute() {
  return <AgentPanel />;
}
