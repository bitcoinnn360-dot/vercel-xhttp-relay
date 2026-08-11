#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { onRequestGet as fetchStocks } from '../functions/api/stocks.js'
import { onRequestGet as fetchNav } from '../functions/api/nav.js'
import { buildProductionBundle } from '../functions/lib/production_core.js'
import { buildFinancialsBundle } from '../functions/lib/financials_core.js'

const execFileAsync = promisify(execFile)

// GitHub's curl reaches BourseView reliably; Node/undici intermittently resets
// the large quote-history responses. Keep the normal Fetch API contract for
// the existing parsers while using curl as the transport.
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  const args = ['--silent', '--show-error', '--location', '--max-time', '90']
  const headers = new Headers(init.headers || {})
  for (const [name, value] of headers.entries()) args.push('--header', `${name}: ${value}`)
  args.push('--write-out', '\n%{http_code}', url)
  try {
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 50 * 1024 * 1024 })
    const marker = stdout.lastIndexOf('\n')
    const body = marker >= 0 ? stdout.slice(0, marker) : ''
    const status = Number(marker >= 0 ? stdout.slice(marker + 1) : 599) || 599
    return new Response(body, { status })
  } catch {
    throw new TypeError('fetch failed')
  }
}

const cookie = String(process.env.BOURSEVIEW_COOKIE || '').trim()
if (!cookie) throw new Error('BOURSEVIEW_COOKIE missing')

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
mkdirSync(outDir, { recursive: true })

async function run(handler, path) {
  const response = await handler({
    request: new Request(`https://snapshot.local${path}?refresh=1`),
    env: { BOURSEVIEW_COOKIE: cookie },
    waitUntil() {},
  })
  const body = await response.json()
  if (!body?.ok) throw new Error(`${path} failed: ${(body?.errors || [body?.error]).slice(0, 3).join(' | ')}`)
  return body
}

const stocks = await run(fetchStocks, '/api/stocks')
if (stocks.source !== 'bourseview-adjusted' || stocks.stocks?.length < 20) {
  throw new Error(`incomplete BourseView stocks snapshot: ${stocks.stocks?.length || 0}`)
}
writeFileSync(join(outDir, 'mineral_stocks.json'), JSON.stringify(stocks, null, 2))

const nav = await run(fetchNav, '/api/nav')
if (!(nav.liveCount > 0) || !String(nav.source || '').startsWith('bourseview')) {
  throw new Error(`invalid BourseView NAV snapshot: ${nav.liveCount || 0}`)
}
writeFileSync(join(outDir, 'nav.json'), JSON.stringify(nav, null, 2))

const production = await buildProductionBundle(cookie)
if (!production.ok || !production.companies?.length) throw new Error('BourseView production snapshot failed')
writeFileSync(join(outDir, 'production.json'), JSON.stringify(production, null, 2))

const financials = await buildFinancialsBundle(cookie)
if (!financials.ok || !financials.companies?.length) throw new Error('BourseView financials snapshot failed')
writeFileSync(join(outDir, 'financials.json'), JSON.stringify(financials, null, 2))

console.log(
  `BourseView snapshots: stocks=${stocks.stocks.length} nav=${nav.liveCount} production=${production.companies.length} financials=${financials.companies.length}`,
)
