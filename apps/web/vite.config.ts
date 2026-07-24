import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [
    // ponytail: TanStack Router's Vite plugin generates `routeTree.gen.ts`
    // from `src/routes/**/*.tsx` before React's plugin runs, so the route
    // tree is always available when the app boots.
    TanStackRouterVite({
      routesDirectory: 'src/routes',
      generatedRouteTree: 'src/routeTree.gen.ts',
    }),
    react(),
  ],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // ponytail: split the heavy CodeMirror stack into its own chunk so the
    // initial bundle (router + app shell) stays under the 500 kB warning
    // limit. The editor route lazy-loads the editor module which pulls
    // these chunks in only when the user opens a file.
    rollupOptions: {
      output: {
        manualChunks: {
          'cm-core': [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            '@codemirror/language',
            '@codemirror/autocomplete',
            '@codemirror/lint',
            '@codemirror/search',
            '@lezer/highlight',
          ],
          'cm-lsp': ['@codemirror/lsp-client'],
          'cm-lang-js': ['@codemirror/lang-javascript'],
          'cm-lang-css': ['@codemirror/lang-css'],
          'cm-lang-html': ['@codemirror/lang-html'],
          'cm-lang-json': ['@codemirror/lang-json'],
          'cm-lang-yaml': ['@codemirror/lang-yaml'],
          'cm-lang-python': ['@codemirror/lang-python'],
          'cm-lang-markdown': ['@codemirror/lang-markdown'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
