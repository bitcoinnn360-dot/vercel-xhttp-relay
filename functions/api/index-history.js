/**
 * Cloudflare Pages Function — durable TEDPIX OHLC history.
 * The browser used to fetch TGJU directly and then discard the result in
 * MarketOverview. Serving it here removes the client-side CORS/timeout path
 * and caches a verified full series for the historical chart.
 */
const TGJU_HISTORY = 'https://api.tgju.org/v1/market/indicator/summary-table-data/bourse'
const CACHE_KEY = 'https://index-history.internal/tedpix-v1'
const FROM_DATE = '2022/01/01'

function num(raw) {
  const digits = String(raw ?? '')
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '')
  const value = Number(digits)
  return Number.isFinite(value) ? value : null
}

function date(raw) {
  return String(raw || '').replace(/-/g, '/').slice(0, 10)
}

function candlesFrom(rows) {
  const byDate = new Map()
  for (const row of rows || []) {
    if (!Array.isArray(row) || row.length < 8) continue
    const day = date(row[6])
    if (!day || day < FROM_DATE) continue
    const open = num(row[0])
    const low = num(row[1])
    const high = num(row[2])
    const close = num(row[3])
    if ([open, high, low, close].some((v) => v == null)) continue
    byDate.set(day, { date: day, dateJalali: String(row[7] || ''), open, high, low, close })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export async function onRequestGet() {
  const cache = typeof caches === 'undefined' ? null : caches.default
  if (cache) {
    const hit = await cache.match(CACHE_KEY)
    if (hit) return hit
  }

  const upstream = await fetch(TGJU_HISTORY, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(9000),
  })
  if (!upstream.ok) {
    return Response.json({ ok: false, error: `TGJU ${upstream.status}`, candles: [] }, { status: 502 })
  }
  const payload = await upstream.json()
  const candles = candlesFrom(payload?.data)
  // A short response is not a usable «از ۱۴۰۱» chart; let the client use its fallback.
  if (candles.length < 200) {
    return Response.json({ ok: false, error: 'TGJU history is incomplete', candles: [] }, { status: 502 })
  }

  const response = Response.json(
    { ok: true, source: 'tgju-server-cache', updatedAt: new Date().toISOString(), candles },
    { headers: { 'Cache-Control': 'public, max-age=43200' } },
  )
  if (cache) await cache.put(CACHE_KEY, response.clone())
  return response
}

