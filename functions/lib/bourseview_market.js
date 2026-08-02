/**
 * BourseView market helpers — IFB movers + optional index quotes.
 * Uses www.bourseview.com/api/v2 (same cookie shape as /api/nav).
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BV_BASE = 'https://www.bourseview.com'

/** TSE equal-weight index on BourseView. */
export const BV_EQUAL_WEIGHT = { exchange: 'IRTSENO', isin: 'IRX6XTPI0026', name: 'شاخص کل (هم وزن)' }
/** TSE total index (TEDPIX). */
export const BV_TEDPIX = { exchange: 'IRTSENO', isin: 'IRX6XTPI0006', name: 'شاخص کل بورس' }

export function normalizeCookie(raw) {
  let c = String(raw || '').trim()
  if (!c) return ''
  if (!/authentication=/i.test(c) && !/;/.test(c) && c.length > 20) {
    c = `authentication=${c}`
  }
  return c
}

async function bvJson(cookie, path, { attempts = 2, timeoutMs = 10000 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BV_BASE}${path}`, {
        headers: {
          Cookie: cookie,
          Accept: 'application/json',
          'User-Agent': UA,
          Referer: 'https://www.bourseview.com/',
          Origin: 'https://www.bourseview.com',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      // Do not retry 403/429 — each attempt burns a Worker subrequest.
      if (!res.ok) throw new Error(`bourseview ${res.status} ${path}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 150 * (i + 1)))
    }
  }
  throw lastErr || new Error(`bourseview failed ${path}`)
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return out
}

/**
 * Live index quote from BourseView (close / change / pct).
 */
export async function scrapeBourseViewIndex(cookie, meta) {
  const c = normalizeCookie(cookie)
  if (!c) return { ok: false, error: 'BOURSEVIEW_COOKIE missing' }
  try {
    const q = await bvJson(
      c,
      `/api/v2/exchanges/${meta.exchange}/indices/${meta.isin}/quotes?timeFrame=daily&lastN=2`,
    )
    const items = Array.isArray(q?.items) ? [...q.items] : []
    items.sort((a, b) => Number(b?.date || 0) - Number(a?.date || 0))
    const last = items[0]
    if (!last) throw new Error('empty quotes')
    const close = Number(last.close ?? last.vwap)
    const prev = Number(last.previousVwap) || (items[1] ? Number(items[1].close ?? items[1].vwap) : NaN)
    if (!Number.isFinite(close) || !(close > 0)) throw new Error('bad close')
    let change = Number.isFinite(prev) && prev > 0 ? close - prev : null
    let changePct = change != null && prev > 0 ? (change / prev) * 100 : null
    return {
      ok: true,
      name: meta.name,
      value: close,
      change: change != null ? Math.round(change * 100) / 100 : 0,
      changePct: changePct != null ? Math.round(changePct * 100) / 100 : 0,
      source: 'bourseview',
      asOf: last.dateTime || last.shamsiDate || last.date || null,
    }
  } catch (e) {
    return { ok: false, error: String(e), source: 'bourseview' }
  }
}

/**
 * IFB (فرابورس) positive/negative impact panel from BourseView quotes.
 * Impact ≈ index × (mv / Σmv) × dayReturn — same shape as board impacts.
 */
export async function scrapeBourseViewIfbMovers(cookie, { indexValue = null, topN = 40, concurrency = 3 } = {}) {
  const c = normalizeCookie(cookie)
  if (!c) {
    return { ok: false, source: 'bourseview-ifb', error: 'BOURSEVIEW_COOKIE missing', ifbPos: [], ifbNeg: [] }
  }
  try {
    const listed = await bvJson(c, '/api/v2/exchanges/IRIFBNO/stocks', { timeoutMs: 20000 })
    const items = Array.isArray(listed?.items) ? listed.items : []
    const equities = items
      .filter((s) => s?.type === 'CommonStock' && Number(s.marketCap) > 0 && s.isin)
      .sort((a, b) => Number(b.marketCap) - Number(a.marketCap))
      .slice(0, topN)

    if (!equities.length) throw new Error('no IFB equities')

    const rows = await mapPool(equities, concurrency, async (s) => {
      try {
        const q = await bvJson(
          c,
          `/api/v2/exchanges/IRIFBNO/stocks/${s.isin}/quotes?timeFrame=daily&lastN=2`,
          { attempts: 2, timeoutMs: 10000 },
        )
        const quotes = Array.isArray(q?.items) ? [...q.items] : []
        quotes.sort((a, b) => Number(b?.date || 0) - Number(a?.date || 0))
        const last = quotes[0]
        if (!last) return null
        const close = Number(last.close ?? last.vwap)
        let prev = Number(last.previousVwap)
        if (!(prev > 0) && quotes[1]) prev = Number(quotes[1].close ?? quotes[1].vwap)
        if (!(close > 0) || !(prev > 0)) return null
        const move = (close - prev) / prev
        if (!Number.isFinite(move) || Math.abs(move) > 0.22) return null
        return {
          symbol: String(s.symbolPouyaFa || s.symbolPouya || '').trim(),
          mv: Number(s.marketCap) || 0,
          move,
        }
      } catch {
        return null
      }
    })

    const okRows = rows.filter((r) => r && r.symbol && r.mv > 0)
    const totalMv = okRows.reduce((a, r) => a + r.mv, 0)
    const index = Number(indexValue) > 0 ? Number(indexValue) : 1
    if (!totalMv) throw new Error('no quoted IFB rows')

    const scored = okRows.map((r) => ({
      symbol: r.symbol,
      impact: Math.round(index * (r.mv / totalMv) * r.move * 10) / 10,
    }))
    const ifbPos = scored.filter((x) => x.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 5)
    const ifbNeg = scored.filter((x) => x.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, 5)
    return {
      ok: Boolean(ifbPos.length || ifbNeg.length),
      source: 'bourseview-ifb',
      ifbPos,
      ifbNeg,
      universe: okRows.length,
      indexValue: index,
    }
  } catch (e) {
    return { ok: false, source: 'bourseview-ifb', error: String(e), ifbPos: [], ifbNeg: [] }
  }
}
