import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))
const version = packageJson.version

// Backend server URL - can be overridden via environment variable
const BACKEND_URL = process.env.VITE_BACKEND_URL || 'http://localhost:4000'

// https://vite.dev/config/
export default defineConfig({
  define: {
    '__APP_VERSION__': JSON.stringify(version),
  },
  server: {
    host: true,
    // Proxy API requests to the backend server during development
    // This eliminates CORS issues entirely by making all API calls appear as same-origin requests
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          // Handle proxy errors gracefully
          proxy.on('error', (err) => {
            console.error('Proxy error:', err.message);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward custom headers through the proxy
            if (req.headers['ngrok-skip-browser-warning']) {
              proxyReq.setHeader('ngrok-skip-browser-warning', req.headers['ngrok-skip-browser-warning'] as string);
            }
            if (req.headers['bypass-tunnel-reminder']) {
              proxyReq.setHeader('Bypass-Tunnel-Reminder', req.headers['bypass-tunnel-reminder'] as string);
            }
          });
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icon.png'],
      manifest: {
        name: 'Japan Itinerary',
        short_name: 'Japan Itinerary',
        description: 'Japan Trip Itinerary',
        theme_color: '#FF3B3F',
        background_color: '#0F1014',
        display: 'standalone',
        icons: [
          {
            src: 'icon.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      }
    })
  ],
})
