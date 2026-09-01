import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'favicon-32x32.png',
        'apple-touch-icon.png',
        'fonts/sora-700.woff2',
        'fonts/sora-800.woff2',
      ],
      manifest: {
        name: 'edusolutionsmaldives.com',
        short_name: 'EduSolution',
        description: 'Learning, simplified — courses, progress, and resources in one place.',
        start_url: '/',
        // `display` is the required, universally-supported fallback (hides
        // the browser chrome — URL bar, tabs — but keeps the OS status bar,
        // e.g. clock/battery). `display_override` is tried first, in order,
        // by browsers that support it: 'fullscreen' additionally hides the
        // status bar for full immersion (Android/desktop installs mainly —
        // iOS doesn't distinguish fullscreen from standalone for installed
        // web apps, so this has no extra effect there), falling back to our
        // existing 'standalone' behavior anywhere fullscreen isn't
        // supported or the OS declines it, rather than replacing it outright.
        display: 'standalone',
        display_override: ['fullscreen', 'standalone'],
        background_color: '#ffffff',
        theme_color: '#0e7c86',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The API is served from a different origin in production and
        // should always hit the network, never be cached by the service worker.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  // Same proxy as the dev server, so `npm run preview` (serving the real
  // production build locally) can also reach the local backend — without
  // this, `/api/...` requests just 404 against the static preview server.
  preview: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
