// ponytail: the root route wraps every page in the layout (topbar, mobile
// nav, workspace picker). Each leaf route renders into <Outlet/> via
// the layout's <Outlet/> call.

import { createRootRoute } from '@tanstack/react-router';
import { Layout } from '../layout';

export const Route = createRootRoute({
  component: Layout,
});
