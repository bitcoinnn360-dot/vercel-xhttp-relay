import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function parseCsv(text: string, limit: number) {
  const lines = text.trim().split(/\r?\n/).slice(1)
  const points: { date: string; value: number }[] = []
  for (const line of lines) {
    const [date, value] = line.split(',')
    if (!date || value === '.' || value === '' || Number.isNaN(Number(value))) continue
    points.push({ date, value: Number(value) })
  }
  return points.slice(-limit)
}

function localApiPlugin(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url) return next()
          const url = new URL(req.url, 'http://localhost')

          if (url.pathname === '/api/fred') {
            const id = url.searchParams.get('id') || 'DCOILBRENTEU'
            const limit = Math.min(Number(url.searchParams.get('limit') || 180), 2000)
            const fredUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`
            const r = await fetch(fredUrl)
            const text = await r.text()
            const history = parseCsv(text, limit)
            const last = history[history.length - 1]
            const prev = history[history.length - 2]
            const change = last && prev ? last.value - prev.value : 0
            const changePct = last && prev && prev.value ? (change / prev.value) * 100 : 0
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, id, last: last?.value ?? null, change, changePct, history }))
            return
          }

          if (url.pathname === '/api/live') {
            const r = await fetch('https://call2.tgju.org/ajax.json')
            const json = (await r.json()) as { current?: Record<string, unknown> }
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, updatedAt: new Date().toISOString(), rawKeys: Object.keys(json.current || {}).length }))
            return
          }
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: String(e) }))
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApiPlugin()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
})
