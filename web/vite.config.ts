import react from '@vitejs/plugin-react'
import { cpSync, createReadStream, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/** The region files, written by crates/prep at the root of the repository (not in web/public: data, not the app's) */
const DATA = resolve(import.meta.dirname, '../data')

/** Serves the data folder under `<base>data/` while developing, and copies it into the build */
const regionData = (): Plugin => ({
  name: 'region-data',
  configureServer(server) {
    server.middlewares.use(`${server.config.base}data`, (req, res, next) => {
      const path = resolve(DATA, `.${decodeURIComponent((req.url ?? '/').split('?')[0])}`)
      // Nothing outside the folder; served as stored (the page inflates the gzipped files itself)
      if (!path.startsWith(DATA + sep) || !statSync(path, { throwIfNoEntry: false })?.isFile()) return next()
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', statSync(path).size)
      createReadStream(path).pipe(res)
    })
  },
  writeBundle({ dir }) {
    if (dir) cpSync(DATA, resolve(dir, 'data'), { recursive: true })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), regionData()],
  // `@/engine/network` → src/engine/network (same alias as tsconfig.app.json)
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  // GitHub Pages serves the app under /geo-reach/ (set by the deploy workflow)
  base: process.env.BASE_PATH ?? '/',
  // Three pages: the map, how it works, the legal notice
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        howItWorks: resolve(import.meta.dirname, 'how-it-works.html'),
        legal: resolve(import.meta.dirname, 'legal.html'),
      },
    },
  },
  // Module workers: ours (travel time field, buildings)
  worker: { format: 'es' },
  // The map engine is served as it is built: its WebAssembly and its workers are loaded by URL
  optimizeDeps: { exclude: ['isard'] },
  // 127.0.0.1 rather than localhost: on the IGN network, localhost resolves to localhost.ign.fr (the proxy)
  server: { host: '127.0.0.1' },
})
