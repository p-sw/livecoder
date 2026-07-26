import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    // ponytail: TanStack Router's Vite plugin generates `routeTree.gen.ts`
    // from `src/routes/**/*.tsx` before React's plugin runs, so the route
    // tree is always available when the app boots.
    TanStackRouterVite({
      routesDirectory: 'src/routes',
      generatedRouteTree: 'src/routeTree.gen.ts',
    }),
    // ponytail: Tailwind v4 processes utilities at build time. The plugin
    // scans the source tree for class names; no separate postcss config
    // needed. The `src/styles.css` file holds the @import + @theme block.
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:3001', ws: true },
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
          react: ['react', 'react-dom'],
          'cm-lang-yaml': ['@codemirror/lang-yaml'],
          'cm-lang-python': ['@codemirror/lang-python'],
          'cm-lang-markdown': ['@codemirror/lang-markdown'],
        },
      },
    },
  },
});
