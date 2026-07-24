// ponytail: thin wrapper. The CM6 editor (with LSP) lives in EditorPanel
// so the route file stays a single line.

import { createFileRoute } from '@tanstack/react-router';
import { EditorPanel } from '../components/EditorPanel';

export const Route = createFileRoute('/editor')({
  component: EditorRoute,
});

function EditorRoute() {
  return <EditorPanel />;
}
