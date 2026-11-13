/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative base so the same build works on any static host sub-path and inside Capacitor.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'engines/stockfish-19-lite-single.js', 'engines/STOCKFISH-LICENSE.txt'],
      manifest: {
        name: 'KnightScope',
        short_name: 'KnightScope',
        description: 'Every Game Teaches You Something. Local chess game review and personal training.',
        theme_color: '#0B1020',
        background_color: '#0B1020',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm,json}'],
        // Precache the lite engine (~1.8 MB) but never the optional full engine (~94 MB).
        globIgnores: ['**/stockfish-19-single.*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    testTimeout: 60000,
    setupFiles: ['tests/setup.ts'],
  },
});
