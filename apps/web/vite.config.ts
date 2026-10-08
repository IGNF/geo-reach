import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Module workers: ours (travel time field) and MapLibre's
  worker: { format: 'es' },
  // 127.0.0.1 rather than localhost: on the IGN network, localhost resolves to localhost.ign.fr (the proxy)
  server: { host: '127.0.0.1' },
})
