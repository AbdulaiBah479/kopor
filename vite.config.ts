import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// Strict Content-Security-Policy for production builds (dev server needs inline scripts).
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.groq.com https://generativelanguage.googleapis.com https://openrouter.ai https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  "worker-src 'self' blob:", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');
function securityHeaders(): Plugin {
  return {
    name: 'kopor-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<title>', `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <title>`),
  };
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    securityHeaders(),
    // Offline-first: Google Workbox precaches the whole app; new versions activate automatically.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false, // public/manifest.webmanifest is the source of truth
      includeAssets: ['icons/*.png', 'icons/*.svg', 'manifest.webmanifest'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Mobile data is expensive: precache only the core app. Heavy optional tools (scanner, PDF, Excel,
        // printer, cloud, crash reporting) are cached the first time someone uses them.
        globIgnores: ['**/Scanner-*', '**/pdf-*', '**/excel-*', '**/html2canvas*', '**/purify*', '**/index.es-*', '**/printer-*', '**/cloud-*', '**/sentry-*', '**/tour-*'],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes('/assets/'),
          handler: 'CacheFirst',
          options: { cacheName: 'kopor-on-demand', expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 90 } },
        }],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'], data: ['dexie', 'dexie-react-hooks'], i18n: ['i18next', 'react-i18next'],
          cloud: ['@supabase/supabase-js'], sentry: ['@sentry/browser'],
        },
      },
    },
  },
  server: { port: 5173 },
});
