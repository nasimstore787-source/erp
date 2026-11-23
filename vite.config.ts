import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'نقطة البيع', short_name: 'نقطة البيع', lang: 'ar', dir: 'rtl', start_url: '/', scope: '/', display: 'standalone',
        orientation: 'any', background_color: '#f3f5f2', theme_color: '#102e27',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // the app shell is precached; API calls are never cached or answered by the worker (data comes from IndexedDB / the server)
        navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,webp,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    ...(mode === 'design'
      ? { allowedHosts: ['workspace-jo2tj2ra-5173-45deec4de8f4b269.v0.build'] }
      : { proxy: { '/api': 'http://127.0.0.1:3000' } }),
  },
}));
