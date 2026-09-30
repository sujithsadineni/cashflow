import process from 'node:process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // '/' locally; the GitHub Pages demo is served from /cashflow/ (npm run build:demo).
  base: process.env.VITE_BASE ?? '/',

  server: {
    port: 5173,

    /**
     * The proxy.
     *
     * Anything the browser requests at /api/... is forwarded to the
     * backend on port 4000. So your React code writes:
     *
     *     fetch('/api/people')
     *
     * and never mentions a port. Two things fall out of that:
     *
     *   1. No CORS. The browser thinks everything came from :5173,
     *      because as far as it can tell, it did.
     *   2. This is how it deploys. In production a reverse proxy does
     *      the same job and the frontend code doesn't change.
     */
    proxy: {
      '/api': {
        // 127.0.0.1, not localhost: see CLAUDE.md's gotchas. API_URL lets the
        // demo recorder point a second dev server at a demo API.
        target: process.env.API_URL ?? 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
});
