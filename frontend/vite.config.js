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
        name: 'EduSolution.com',
        short_name: 'EduSolution',
        description: 'Learning, simplified — courses, progress, and resources in one place.',
        start_url: '/',
        display: 'standalone',
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
})
