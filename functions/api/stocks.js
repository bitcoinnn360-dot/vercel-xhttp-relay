/**
 * Cloudflare Pages Function: mineral stock snapshots + period returns.
 *
 * Primary source: SourceArena (same token as overview)
 *   - live: ?token=&name=SYMBOL
 *   - history: ?token=&name=SYMBOL&days=N
 *   - adjusted history (if activated): &adjusted=1
 *
 * Shakhesban is intentionally NOT used (bad/stale chart data).
 * BourseView needs login — wire via BOURSEVIEW_TOKEN / BOURSEVIEW_COOKIE when available.
 * Codal corporate-action adjustment can layer on unadjusted history later.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SOURCEARENA_API = 'https://apis.sourcearena.ir/api/'
const DEMO_TOKEN = 'bba6d330a87bac533f18cc245d3baeaa'

const MINERAL_STOCKS = [
  { name: 'توسعه معادن و فلزات', symbol: 'ومعادن' },
  { name: 'تجلی توسعه معادن و فلزات', symbol: 'تجلی' },
  { name: 'گروه مدیریت سرمایه‌گذاری امید', symbol: 'وامید' },
  { name: 'سرمایه‌گذاری صدر تأمین', symbol: 'تاصیکو' },
  { name: 'هلدینگ صنایع معدنی خاورمیانه', symbol: 'میدکو' },
  { name: 'صنایع و معادن احیاء سپاهان', symbol: 'واحیا' },
  { name: 'بین‌المللی توسعه صنایع و معادن غدیر', symbol: 'وغدیر' },
  { name: 'گروه صنایع معادن فلات ایرانیان', symbol: 'فلات' },
  { name: 'معدنی و صنعتی گل‌گهر', symbol: 'کگل' },
  { name: 'معدنی و صنعتی چادرملو', symbol: 'کچاد' },
  { name: 'سنگ آهن گهرزمین', symbol: 'کگهر' },
  { name: 'توسعه معدنی و صنعتی صبانور', symbol: 'کنور' },
  { name: 'فرآوری معدنی اپال کانی پارس', symbol: 'اپال' },
  { name: 'فولاد مبارکه اصفهان', symbol: 'فولاد' },
  { name: 'فولاد خوزستان', symbol: 'فخوز' },
  { name: 'فولاد هرمزگان جنوب', symbol: 'هرمز' },
  { name: 'آهن و فولاد ارفع', symbol: 'ارفع' },
  { name: 'فولاد خراسان', symbol: 'فخاس' },
  { name: 'فولاد امیرکبیر کاشان', symbol: 'فاما' },
  { name: 'فولاد کاوه جنوب کیش', symbol: 'کاوه' },
  { name: 'ذوب آهن اصفهان', symbol: 'ذوب' },
  { name: 'جهان فولاد سیرجان', symbol: 'فجهان' },
  { name: 'فولاد سیرجان ایرانیان', symbol: 'فسپا' },
  { name: 'ملی صنایع مس ایران', symbol: 'فملی' },
  { name: 'کارخانجات تولیدی شهید قندی', symbol: 'بکام' },
]

const CACHE_TTL_MS = 20 * 60 * 1000
const CACHE_KEY = 'https://cache.local/mineral-stocks-sa-v2'
const HISTORY_DAYS = 280 // ~1 trading year — enough for Jalali YTD + month/week

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

function sessionPrice(row) {
  // قیمت پایانی (final) preferred; fall back to last/close
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

async function fetchHistory(token, symbol, adjustedEnabled) {
  if (adjustedEnabled) {
    try {
      const adj = await saFetch(token, {
        name: symbol,
        days: String(HISTORY_DAYS),
        adjusted: '1',
      })
      if (Array.isArray(adj) && adj.length) {
        return { rows: adj, adjusted: true, source: 'sourcearena-adjusted' }
      }
    } catch {
      /* fall through */
    }
  }

  const raw = await saFetch(token, { name: symbol, days: String(HISTORY_DAYS) })
  if (!Array.isArray(raw)) throw new Error(raw?.Error || 'history empty')
  return { rows: raw, adjusted: false, source: 'sourcearena-unadjusted' }
}

function returnsFromHistory(rows) {
  // SourceArena returns newest-first
  const closes = []
  for (const row of rows) {
    const p = sessionPrice(row)
    const d = String(row.date || '')
    if (!d || p == null || !(p > 0)) continue
    closes.push({ date: d, price: p })
  }
  if (!closes.length) return {}

  const last = closes[0].price
  // week ≈ 5 sessions, month ≈ 22 sessions
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

async function scrapeSymbol(token, symbol, adjustedEnabled) {
  const [live, hist] = await Promise.all([
    saFetch(token, { name: symbol }),
    fetchHistory(token, symbol, adjustedEnabled),
  ])

  if (!live || live.Error || !live.name) {
    throw new Error(live?.Error || 'live empty')
  }

  const rets = returnsFromHistory(hist.rows)
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

  // Optional: BourseView session for future adjusted charts (not required today)
  const bourseviewReady = Boolean(env?.BOURSEVIEW_TOKEN || env?.BOURSEVIEW_COOKIE)
  const adjustedEnabled = await probeAdjustedEnabled(token)

  const results = await Promise.allSettled(
    MINERAL_STOCKS.map((r) => scrapeSymbol(token, r.symbol, adjustedEnabled)),
  )
  const stocks = []
  const errors = []
  let adjustedCount = 0
  results.forEach((r, i) => {
    const meta = MINERAL_STOCKS[i]
    if (r.status === 'fulfilled') {
      if (r.value.returnsAdjusted) adjustedCount += 1
      stocks.push({ ...r.value, name: meta.name })
    } else {
      errors.push(`${meta.symbol}: ${r.reason}`)
      stocks.push({
        symbol: meta.symbol,
        name: meta.name,
        returnsAdjusted: false,
        returnsSource: 'error',
      })
    }
  })

  let payload = {
    ok: stocks.some((s) => s.historyCount > 0 || s.closePrice != null),
    updatedAt: new Date().toISOString(),
    source: adjustedCount
      ? 'sourcearena-adjusted'
      : 'sourcearena-unadjusted',
    note: adjustedCount
      ? 'بازدهی از قیمت تعدیل‌شده SourceArena'
      : 'بازدهی از قیمت غیرتعدیل SourceArena (days). برای تعدیل: فعال‌سازی adjusted روی توکن، یا BourseView/کدال.',
    bourseviewReady,
    stocks,
    errors: errors.slice(0, 8),
  }

  if (!payload.ok) {
    const fallback = await loadStaticFallback(origin)
    if (fallback?.stocks?.length) {
      payload = {
        ok: true,
        updatedAt: fallback.updatedAt || payload.updatedAt,
        source: fallback.source || 'static-mineral_stocks',
        note: 'fallback static',
        bourseviewReady,
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
