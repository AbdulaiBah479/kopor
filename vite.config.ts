import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Strict Content-Security-Policy for production builds (dev server needs inline scripts).
const CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.github.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  "worker-src 'self' blob:", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');
function securityHeaders(): Plugin {
  return {
    name: 'kopor-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<title>', `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <title>`),
  };
}

// Offline receipt reading (Tesseract): the engine and English data are served from the app itself under tesseract/
// (never a third-party CDN). Not precached: about 7 MB, downloaded the first time a receipt is read without the AI.
const TESSERACT: Record<string, string> = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
function tesseractAssets(): Plugin {
  return {
    name: 'kopor-tesseract',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/tesseract\/([\w./-]+)$/);
        const src = m && TESSERACT[m[1]];
        if (!src) return next();
        res.setHeader('Content-Type', src.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        createReadStream(src).pipe(res);
      });
    },
    writeBundle(opts) {
      for (const [to, from] of Object.entries(TESSERACT)) {
        if (!existsSync(from)) throw new Error(`Missing ${from}: run npm install`);
        const dest = join(opts.dir ?? 'dist', 'tesseract', to);
        mkdirSync(join(dest, '..'), { recursive: true });
        copyFileSync(from, dest);
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    securityHeaders(),
    tesseractAssets(),
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
        globIgnores: ['**/Scanner-*', '**/pdf-*', '**/excel-*', '**/xlsx-*', '**/html2canvas*', '**/purify*', '**/index.es-*', '**/printer-*', '**/cloud-*', '**/sentry-*', '**/tour-*',
          '**/tesseract/**', '**/inter-cyrillic*', '**/inter-greek*', '**/inter-vietnamese*', '**/og.*'],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes('/tesseract/'),
          handler: 'CacheFirst',
          options: { cacheName: 'kopor-ocr', expiration: { maxEntries: 8 } },
        }, {
          urlPattern: ({ url }) => url.pathname.includes('/assets/'),
          handler: 'CacheFirst',
          options: { cacheName: 'kopor-on-demand', expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 90 } },
        }],
        navigateFallback: 'index.html',
        // Reminder notifications (free Web Push): shows them and opens the right page when tapped.
        importScripts: ['push-sw.js'],
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
        // Name the lazily loaded cloud chunk so the service worker can skip precaching it.
        chunkFileNames: (chunk) => (chunk.moduleIds.some((id) => id.includes('@supabase')) ? 'assets/cloud-[hash].js' : 'assets/[name]-[hash].js'),
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'], data: ['dexie', 'dexie-react-hooks'], i18n: ['i18next', 'react-i18next'],
          sentry: ['@sentry/browser'], // (Supabase is left to automatic splitting so it stays lazy)
        },
      },
    },
  },
  server: { port: 5173 },
});
