import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the app under /geo-reach/ (set by the deploy workflow)
  base: process.env.BASE_PATH ?? '/',
  // Two pages: the map, and how it works
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), howItWorks: resolve(import.meta.dirname, 'how-it-works.html') },
    },
  },
  // Module workers: ours (travel time field) and MapLibre's
  worker: { format: 'es' },
  // 127.0.0.1 rather than localhost: on the IGN network, localhost resolves to localhost.ign.fr (the proxy)
  server: { host: '127.0.0.1' },
})
