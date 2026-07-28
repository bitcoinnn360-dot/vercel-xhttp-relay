/**
 * Cloudflare Pages Function: mineral stock snapshots + period returns.
 *
 * Primary: BourseView adjusted daily quotes (close * adjustingCoef)
 *   requires env BOURSEVIEW_COOKIE (`authentication=…`; optional `; id_token=…`)
 * Fallback: SourceArena live + unadjusted history (rate-limited / no adjust on demo)
 * Last resort: /data/mineral_stocks.json
 *
 * Shakhesban is intentionally NOT used.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SOURCEARENA_API = 'https://apis.sourcearena.ir/api/'
const DEMO_TOKEN = 'bba6d330a87bac533f18cc245d3baeaa'
const BV_BASE = 'https://www.bourseview.com'
const BV_HISTORY_N = 300
const SA_HISTORY_DAYS = 280

const MINERAL_STOCKS = [
  { name: 'توسعه معادن و فلزات', symbol: 'ومعادن', isin: 'IRO1MADN0001', exchange: 'IRTSENO' },
  { name: 'تجلی توسعه معادن و فلزات', symbol: 'تجلی', isin: 'IRO3TMMZ0001', exchange: 'IRIFBNO' },
  { name: 'گروه مدیریت سرمایه‌گذاری امید', symbol: 'وامید', isin: 'IRO1OIMC0001', exchange: 'IRTSENO' },
  { name: 'سرمایه‌گذاری صدر تأمین', symbol: 'تاصیکو', isin: 'IRO1SADR0001', exchange: 'IRTSENO' },
  { name: 'هلدینگ صنایع معدنی خاورمیانه', symbol: 'میدکو', isin: 'IRO1MDKO0001', exchange: 'IRTSENO' },
  { name: 'صنایع و معادن احیاء سپاهان', symbol: 'واحیا', isin: 'IRO7VHYP0001', exchange: 'IRIFBOTC' },
  { name: 'بین‌المللی توسعه صنایع و معادن غدیر', symbol: 'وغدیر', isin: 'IRO1GDIR0001', exchange: 'IRTSENO' },
  { name: 'گروه صنایع معادن فلات ایرانیان', symbol: 'فلات', isin: 'IRO7FLTP0001', exchange: 'IRIFBOTC' },
  { name: 'معدنی و صنعتی گل‌گهر', symbol: 'کگل', isin: 'IRO1GOLG0001', exchange: 'IRTSENO' },
  { name: 'معدنی و صنعتی چادرملو', symbol: 'کچاد', isin: 'IRO1CHML0001', exchange: 'IRTSENO' },
  { name: 'سنگ آهن گهرزمین', symbol: 'کگهر', isin: 'IRO3GZIZ0001', exchange: 'IRIFBNO' },
  { name: 'توسعه معدنی و صنعتی صبانور', symbol: 'کنور', isin: 'IRO1KNRZ0001', exchange: 'IRTSENO' },
  { name: 'فرآوری معدنی اپال کانی پارس', symbol: 'اپال', isin: 'IRO1OPAL0001', exchange: 'IRTSENO' },
  { name: 'فولاد مبارکه اصفهان', symbol: 'فولاد', isin: 'IRO1FOLD0001', exchange: 'IRTSENO' },
  { name: 'فولاد خوزستان', symbol: 'فخوز', isin: 'IRO1FKHZ0001', exchange: 'IRTSENO' },
  { name: 'فولاد هرمزگان جنوب', symbol: 'هرمز', isin: 'IRO3FOHZ0001', exchange: 'IRIFBNO' },
  { name: 'آهن و فولاد ارفع', symbol: 'ارفع', isin: 'IRO3ARFZ0001', exchange: 'IRIFBNO' },
  { name: 'فولاد خراسان', symbol: 'فخاس', isin: 'IRO1FKAS0001', exchange: 'IRTSENO' },
  { name: 'فولاد امیرکبیر کاشان', symbol: 'فجر', isin: 'IRO1FAJR0001', exchange: 'IRTSENO' },
  { name: 'فولاد کاوه جنوب کیش', symbol: 'کاوه', isin: 'IRO1KVEH0001', exchange: 'IRTSENO' },
  { name: 'ذوب آهن اصفهان', symbol: 'ذوب', isin: 'IRO1ZOBI0001', exchange: 'IRTSENO' },
  { name: 'جهان فولاد سیرجان', symbol: 'فجهان', isin: 'IRO3SJSZ0001', exchange: 'IRIFBNO' },
  { name: 'فولاد سیرجان ایرانیان', symbol: 'سیسکو', isin: 'IRO1SSCO0001', exchange: 'IRTSENO' },
  { name: 'ملی صنایع مس ایران', symbol: 'فملی', isin: 'IRO1MSMI0001', exchange: 'IRTSENO' },
  { name: 'کارخانجات تولیدی شهید قندی', symbol: 'بکام', isin: 'IRO1KGND0001', exchange: 'IRTSENO' },
]

const CACHE_TTL_MS = 20 * 60 * 1000
const CACHE_KEY = 'https://cache.local/mineral-stocks-bv-v1'

function num(raw) {
  if (raw == null) return null
  const n = Number(String(raw).replace(/,/g, '').replace(/%/g, '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function pct(from, to) {
  if (from == null || to == null || !(from > 0)) return null
  return Math.round((to / from - 1) * 10000) / 100
}

function jalaliTodayYear() {
  try {
    const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
    })
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
    return Number(parts.year) || 1405
  } catch {
    return 1405
  }
}

function normalizeCookie(raw) {
  if (!raw) return ''
  let c = String(raw).trim()
  if (!c) return ''
  if (!/=/.test(c) && !/\s/.test(c)) {
    // bare authentication token
    c = `authentication=${c}`
  }
  return c
}

function sessionPrice(row) {
  return num(row?.final_price) || num(row?.close_price) || num(row?.last_price) || null
}

function parsePctField(raw) {
  return num(raw)
}

async function saFetch(token, params, attempts = 4) {
  const qs = new URLSearchParams({ token, ...params })
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${SOURCEARENA_API}?${qs}`, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      })
      if (!res.ok) throw new Error(`sourcearena ${res.status}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr || new Error('sourcearena failed')
}

async function fetchSaHistory(token, symbol, adjustedEnabled) {
  if (adjustedEnabled) {
    try {
      const adj = await saFetch(token, {
        name: symbol,
        days: String(SA_HISTORY_DAYS),
        adjusted: '1',
      })
      if (Array.isArray(adj) && adj.length) {
        return { rows: adj, adjusted: true, source: 'sourcearena-adjusted' }
      }
    } catch {
      /* fall through */
    }
  }

  const raw = await saFetch(token, { name: symbol, days: String(SA_HISTORY_DAYS) })
  if (!Array.isArray(raw)) throw new Error(raw?.Error || 'history empty')
  return { rows: raw, adjusted: false, source: 'sourcearena-unadjusted' }
}

function returnsFromSaHistory(rows) {
  const closes = []
  for (const row of rows) {
    const p = sessionPrice(row)
    const d = String(row.date || '')
    if (!d || p == null || !(p > 0)) continue
    closes.push({ date: d, price: p })
  }
  if (!closes.length) return {}

  const last = closes[0].price
  const week = closes[Math.min(5, closes.length - 1)]?.price
  const month = closes[Math.min(22, closes.length - 1)]?.price
  const yStart = `${jalaliTodayYear()}/01/01`
  const ytdRows = closes.filter((c) => c.date >= yStart)
  const ytdBase = ytdRows.length ? ytdRows[ytdRows.length - 1].price : null

  return {
    weekPct: pct(week, last),
    monthPct: pct(month, last),
    ytdPct: pct(ytdBase, last),
    lastPrice: last,
    historyCount: closes.length,
  }
}

function returnsFromBvItems(items) {
  const closes = []
  for (const row of items) {
    const close = num(row?.close)
    if (close == null || !(close > 0)) continue
    const coef = num(row?.adjustingCoef)
    const adj = close * (coef != null && coef > 0 ? coef : 1)
    const shamsi = String(row?.shamsiDate || '').replace(/-/g, '/')
    closes.push({ date: shamsi, price: adj })
  }
  if (!closes.length) return {}

  const last = closes[0].price
  const week = closes[Math.min(5, closes.length - 1)]?.price
  const month = closes[Math.min(22, closes.length - 1)]?.price
  const yStart = `${jalaliTodayYear()}/01/01`
  const ytdRows = closes.filter((c) => c.date && c.date >= yStart)
  const ytdBase = ytdRows.length ? ytdRows[ytdRows.length - 1].price : null

  return {
    weekPct: pct(week, last),
    monthPct: pct(month, last),
    ytdPct: pct(ytdBase, last),
    lastPrice: last,
    historyCount: closes.length,
  }
}

async function bvFetchQuotes(cookie, exchange, isin, attempts = 3) {
  const url = `${BV_BASE}/api/v2/exchanges/${exchange}/stocks/${isin}/quotes?timeFrame=daily&lastN=${BV_HISTORY_N}&expand=shamsiDate`
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: cookie,
          Accept: 'application/json',
          'User-Agent': UA,
          Referer: 'https://www.bourseview.com/',
          Origin: 'https://www.bourseview.com',
        },
        redirect: 'follow',
      })
      if (!res.ok) throw new Error(`bourseview ${res.status}`)
      const json = await res.json()
      const items = Array.isArray(json?.items) ? json.items : null
      if (!items?.length) throw new Error('bourseview empty')
      return items
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 350 * (i + 1)))
    }
  }
  throw lastErr || new Error('bourseview failed')
}

function snapFromBv(meta, items) {
  const latest = items.find((r) => num(r?.close) != null && num(r.close) > 0) || items[0] || {}
  const rets = returnsFromBvItems(items)
  const closePrice = num(latest.close) || rets.lastPrice
  const retFrac = num(latest.returnValue)
  const mv = num(latest.marketCap)
  const tv = num(latest.value)
  const vol = num(latest.volume)

  return {
    symbol: meta.symbol,
    closePrice,
    lastPrice: closePrice,
    dailyPct: retFrac != null ? Math.round(retFrac * 10000) / 100 : null,
    weekPct: rets.weekPct,
    monthPct: rets.monthPct,
    ytdPct: rets.ytdPct,
    marketValueBr: mv != null ? Math.round(mv / 1e9) : undefined,
    volume: vol ?? undefined,
    tradeValueMr: tv != null ? Math.round(tv / 1e6) : undefined,
    returnsAdjusted: true,
    returnsSource: 'bourseview-adjusted',
    historyCount: rets.historyCount || 0,
    isin: meta.isin,
    exchange: meta.exchange,
  }
}

async function scrapeSaSymbol(token, symbol, adjustedEnabled) {
  const [live, hist] = await Promise.all([
    saFetch(token, { name: symbol }),
    fetchSaHistory(token, symbol, adjustedEnabled),
  ])

  if (!live || live.Error || !live.name) {
    throw new Error(live?.Error || 'live empty')
  }

  const rets = returnsFromSaHistory(hist.rows)
  const closePrice = num(live.final_price) || num(live.close_price) || rets.lastPrice
  const lastPrice = num(live.close_price) || closePrice
  const dailyPct =
    parsePctField(live.final_price_change_percent) ??
    parsePctField(live.close_price_change_percent)
  const mv = num(live.market_value)
  const tv = num(live.trade_value)
  const vol = num(live.trade_volume)

  return {
    symbol,
    closePrice,
    lastPrice,
    dailyPct,
    weekPct: rets.weekPct,
    monthPct: rets.monthPct,
    ytdPct: rets.ytdPct,
    marketValueBr: mv != null ? Math.round(mv / 1e9) : undefined,
    volume: vol ?? undefined,
    tradeValueMr: tv != null ? Math.round(tv / 1e6) : undefined,
    returnsAdjusted: Boolean(hist.adjusted),
    returnsSource: hist.source,
    historyCount: rets.historyCount || 0,
    instanceCode: live.instance_code || null,
  }
}

async function probeAdjustedEnabled(token) {
  try {
    const adj = await saFetch(token, { name: 'کگل', days: '5', adjusted: '1' }, 2)
    if (Array.isArray(adj) && adj.length) return true
    if (adj && adj.Error && /adjusted/i.test(String(adj.Error))) return false
  } catch {
    /* ignore */
  }
  return false
}

async function mapInBatches(items, batchSize, worker) {
  const out = []
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize)
    const part = await Promise.allSettled(chunk.map((item, idx) => worker(item, i + idx)))
    out.push(...part)
  }
  return out
}

async function loadStaticFallback(origin) {
  try {
    const res = await fetch(`${origin}/data/mineral_stocks.json`)
    if (!res.ok) return null
    const json = await res.json()
    return Array.isArray(json?.stocks) ? json : Array.isArray(json) ? { stocks: json } : null
  } catch {
    return null
  }
}

export async function onRequestGet(context) {
  const { request, env } = context
  const origin = new URL(request.url).origin
  const token = (env?.SOURCEARENA_TOKEN || DEMO_TOKEN).trim()
  const bvCookie = normalizeCookie(env?.BOURSEVIEW_COOKIE || env?.BOURSEVIEW_TOKEN || '')
  const cache = typeof caches !== 'undefined' ? caches.default : null

  if (cache) {
    const hit = await cache.match(CACHE_KEY)
    if (hit) {
      const cachedAt = Number(hit.headers.get('x-cached-at') || 0)
      if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) {
        return new Response(hit.body, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=60',
            'x-cache': 'HIT',
          },
        })
      }
    }
  }

  const stocks = []
  const errors = []
  let adjustedCount = 0
  let bvOk = 0

  if (bvCookie) {
    const results = await mapInBatches(MINERAL_STOCKS, 5, async (meta) => {
      const items = await bvFetchQuotes(bvCookie, meta.exchange, meta.isin)
      return snapFromBv(meta, items)
    })
    results.forEach((r, i) => {
      const meta = MINERAL_STOCKS[i]
      if (r.status === 'fulfilled') {
        bvOk += 1
        if (r.value.returnsAdjusted) adjustedCount += 1
        stocks.push({ ...r.value, name: meta.name })
      } else {
        errors.push(`${meta.symbol}: ${r.reason}`)
        stocks.push({
          symbol: meta.symbol,
          name: meta.name,
          isin: meta.isin,
          exchange: meta.exchange,
          returnsAdjusted: false,
          returnsSource: 'error',
        })
      }
    })
  }

  // Fill gaps / no cookie → SourceArena
  const needSa = !bvCookie || stocks.some((s) => s.returnsSource === 'error' || !(s.historyCount > 0))
  if (needSa) {
    const adjustedEnabled = await probeAdjustedEnabled(token)
    const missing = MINERAL_STOCKS.filter((meta) => {
      const existing = stocks.find((s) => s.symbol === meta.symbol)
      return !existing || existing.returnsSource === 'error' || !(existing.historyCount > 0)
    })
    const saResults = await Promise.allSettled(
      missing.map((meta) => scrapeSaSymbol(token, meta.symbol, adjustedEnabled)),
    )
    saResults.forEach((r, i) => {
      const meta = missing[i]
      const idx = stocks.findIndex((s) => s.symbol === meta.symbol)
      if (r.status === 'fulfilled') {
        if (r.value.returnsAdjusted) adjustedCount += 1
        const row = { ...r.value, name: meta.name, isin: meta.isin, exchange: meta.exchange }
        if (idx >= 0) stocks[idx] = row
        else stocks.push(row)
      } else {
        errors.push(`${meta.symbol}/sa: ${r.reason}`)
        if (idx < 0) {
          stocks.push({
            symbol: meta.symbol,
            name: meta.name,
            isin: meta.isin,
            exchange: meta.exchange,
            returnsAdjusted: false,
            returnsSource: 'error',
          })
        }
      }
    })
  }

  // Keep universe order
  const bySym = new Map(stocks.map((s) => [s.symbol, s]))
  const ordered = MINERAL_STOCKS.map(
    (m) =>
      bySym.get(m.symbol) || {
        symbol: m.symbol,
        name: m.name,
        isin: m.isin,
        exchange: m.exchange,
        returnsAdjusted: false,
        returnsSource: 'error',
      },
  )

  let source = 'sourcearena-unadjusted'
  let note = 'بازدهی از قیمت غیرتعدیل SourceArena'
  if (bvOk > 0 && adjustedCount > 0) {
    source = 'bourseview-adjusted'
    note = 'بازدهی از قیمت تعدیل‌شده بورس‌ویو (close × adjustingCoef)'
  } else if (adjustedCount > 0) {
    source = 'sourcearena-adjusted'
    note = 'بازدهی از قیمت تعدیل‌شده SourceArena'
  }

  let payload = {
    ok: ordered.some((s) => s.historyCount > 0 || s.closePrice != null),
    updatedAt: new Date().toISOString(),
    source,
    note,
    bourseviewReady: Boolean(bvCookie),
    bourseviewOk: bvOk,
    stocks: ordered,
    errors: errors.slice(0, 12),
  }

  if (!payload.ok) {
    const fallback = await loadStaticFallback(origin)
    if (fallback?.stocks?.length) {
      payload = {
        ok: true,
        updatedAt: fallback.updatedAt || payload.updatedAt,
        source: fallback.source || 'static-mineral_stocks',
        note: 'fallback static',
        bourseviewReady: Boolean(bvCookie),
        bourseviewOk: bvOk,
        stocks: fallback.stocks,
        errors: payload.errors,
      }
    }
  }

  const body = JSON.stringify(payload)
  const response = new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'x-cached-at': String(Date.now()),
      'x-cache': 'MISS',
    },
  })

  if (cache && payload.ok) {
    try {
      await cache.put(CACHE_KEY, response.clone())
    } catch {
      /* ignore */
    }
  }

  return response
}
