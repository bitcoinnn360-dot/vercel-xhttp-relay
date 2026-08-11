#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { onRequestGet as fetchStocks } from '../functions/api/stocks.js'
import { onRequestGet as fetchNav } from '../functions/api/nav.js'

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

console.log(`BourseView snapshots: stocks=${stocks.stocks.length} nav=${nav.liveCount}`)
