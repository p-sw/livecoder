// ponytail: thin wrapper. The settings UI lives in SettingsPanel so the
// route file stays one line.

import { createFileRoute } from '@tanstack/react-router';
import { SettingsPanel } from '../components/SettingsPanel';

export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
});

function SettingsRoute() {
  return <SettingsPanel />;
}
