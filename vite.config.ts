import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Gigio',
        short_name: 'Gigio',
        description: 'Setlists e letras para músicos ao vivo',
        theme_color: '#FF4D6D',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/icons.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/lrclib\.net\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'lrclib-cache', expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: /^https:\/\/api\.genius\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'genius-cache', expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
})
