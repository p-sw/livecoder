// ponytail: the router is the single source of truth for which component
// renders. The route tree is generated from src/routes/** by the Vite
// plugin at startup and re-generated on every save.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import './styles.css';
import { ensurePushSubscription, registerServiceWorker } from './lib/notifications';
import { initPwaInstall } from './lib/pwa-install';


const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root')!;
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

initPwaInstall();

// ponytail: SW + push subscription. Permission prompt only fires once the
// browser allows it (user gesture not required after first grant).
void registerServiceWorker().then(() => {
  void ensurePushSubscription();
});
