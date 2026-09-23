import fs from "fs"
import path from "path"
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The chat emoji picker (frimousse) loads Emojibase data from
// `./emojibase-data/<locale>/{data,messages}.json`. Serve those files from the
// installed emojibase-data package in dev and copy them into the build, so the
// picker never fetches from a public CDN. Only the app's UI locales are shipped.
const EMOJIBASE_FILES = ['en', 'nl', 'de'].flatMap((locale) =>
  ['data.json', 'messages.json'].map((file) => `${locale}/${file}`)
)

function emojibaseData(): Plugin {
  const dataDir = path.resolve(__dirname, 'node_modules/emojibase-data')
  return {
    name: 'emojibase-data',
    configureServer(server) {
      server.middlewares.use('/emojibase-data', (req, res, next) => {
        const rel = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!EMOJIBASE_FILES.includes(rel)) return next()
        res.setHeader('Content-Type', 'application/json')
        res.end(fs.readFileSync(path.join(dataDir, rel)))
      })
    },
    generateBundle() {
      for (const rel of EMOJIBASE_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `emojibase-data/${rel}`,
          source: fs.readFileSync(path.join(dataDir, rel)),
        })
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), emojibaseData()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
      '/docs': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/openapi.json': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
    },
  },
})
