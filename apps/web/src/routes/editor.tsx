// ponytail: lazy-load the editor so the CodeMirror stack (the biggest
// single dependency) only loads when the user actually opens a file.
// Files/Agent/Git stay cheap.

import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteSpinner } from '../components/RouteSpinner';

const EditorPanel = lazy(() =>
  import('../components/EditorPanel').then((m) => ({ default: m.EditorPanel })),
);

export const Route = createFileRoute('/editor')({
  component: EditorRoute,
});

function EditorRoute() {
  return (
    <Suspense fallback={<RouteSpinner />}>
      <EditorPanel />
    </Suspense>
  );
}
