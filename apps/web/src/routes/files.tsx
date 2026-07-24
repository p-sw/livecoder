// ponytail: the route file is the URL-to-component binding. The actual
// file-tree UI lives in <ExplorerPanel/> so the layout, state, and
// styling stay where they belong.

import { createFileRoute } from '@tanstack/react-router';
import { ExplorerPanel } from '../components/ExplorerPanel';

export const Route = createFileRoute('/files')({
  component: FilesRoute,
});

function FilesRoute() {
  return <ExplorerPanel />;
}
