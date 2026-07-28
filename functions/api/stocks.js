/**
 * Cloudflare Pages Function: mineral stock snapshots with adjusted period returns.
 *
 * Source: Shakhesban per-symbol page embeds Highcharts `chart-candle-history`
 * which is an adjusted (افزایش سرمایه / سود) OHLC series. We take field[1] as
 * the usable adjusted close and compute week / month / YTD returns.
 *
 * Cached ~45 minutes to avoid hammering Shakhesban (~1MB HTML per symbol).
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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

const CACHE_TTL_MS = 45 * 60 * 1000
const CACHE_KEY = 'https://cache.local/mineral-stocks-v1'

function num(raw) {
  if (raw == null) return null
  const n = Number(String(raw).replace(/,/g, '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Gregorian timestamp (ms) of Jalali YYYY/01/01. */
function jalaliYearStartMs(jy) {
  // Known anchors for recent years; fallback ~March 21
  const known = {
    1400: Date.UTC(2021, 2, 21),
    1401: Date.UTC(2022, 2, 21),
    1402: Date.UTC(2023, 2, 21),
    1403: Date.UTC(2024, 2, 20),
    1404: Date.UTC(2025, 2, 21),
    1405: Date.UTC(2026, 2, 21),
    1406: Date.UTC(2027, 2, 21),
  }
  if (known[jy]) return known[jy]
  const gy = jy + 621
  return Date.UTC(gy, 2, 21)
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

function pct(from, to) {
  if (from == null || to == null || !(from > 0)) return null
  return Math.round(((to / from - 1) * 10000)) / 100
}

function closestAtOrBefore(closes, tsTarget) {
  let best = null
  for (const [ts, v] of closes) {
    if (ts <= tsTarget) best = v
    else break
  }
  return best
}

function parseChartCloses(html) {
  const m = html.match(/\$\("#chart-candle-history"\)\.msHighcharts\(\{\s*chartData:\s*(\[\[.*?\]\])/s)
  if (!m) return []
  let data
  try {
    data = JSON.parse(m[1])
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  // Highcharts-ish tuple; field[1] tracks live/last and forms continuous adjusted series
  const closes = []
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 2) continue
    const ts = Number(row[0])
    const close = Number(row[1])
    if (!Number.isFinite(ts) || !Number.isFinite(close) || !(close > 0)) continue
    closes.push([ts, close])
  }
  return closes
}

function parseBoardFields(html) {
  const pick = (col) => {
    const a = html.match(new RegExp(`data-col="${col}"[^>]*data-val="([^"]*)"`, 'i'))
    if (a) return a[1]
    const b = html.match(new RegExp(`data-val="([^"]*)"[^>]*data-col="${col}"`, 'i'))
    return b ? b[1] : null
  }
  return {
    lastPrice: num(pick('info.last_trade.PDrCotVal')),
    closePrice: num(pick('info.last_price.PClosing')),
    dailyPct: num(pick('info.last_trade.last_change_percentage')),
    marketValue: num(pick('trades.arzesh_bazar')),
    tradeValue: num(pick('trades.QTotCap')),
    volume: num(pick('trades.QTotTran5J')),
  }
}

function returnsFromCloses(closes) {
  if (!closes.length) return {}
  const lastTs = closes[closes.length - 1][0]
  const last = closes[closes.length - 1][1]
  const ageDays = (Date.now() - lastTs) / 86400000
  const week = closestAtOrBefore(closes, lastTs - 7 * 86400 * 1000)
  const month = closestAtOrBefore(closes, lastTs - 30 * 86400 * 1000)
  const ytdAnchor = jalaliYearStartMs(jalaliTodayYear())
  const ytd = closestAtOrBefore(closes, ytdAnchor) ?? closes.find((c) => c[0] >= ytdAnchor)?.[1]
  // If chart history is stale (>10 calendar days), skip period returns (keep seed).
  if (ageDays > 10) {
    return { adjClose: last, candleCount: closes.length, stale: true }
  }
  return {
    weekPct: pct(week, last),
    monthPct: pct(month, last),
    ytdPct: pct(ytd, last),
    adjClose: last,
    candleCount: closes.length,
  }
}

async function scrapeSymbol(symbol) {
  const url = `https://www.shakhesban.com/markets/stock/${encodeURIComponent(symbol)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      Referer: 'https://www.shakhesban.com/',
    },
  })
  if (!res.ok) throw new Error(`shakhesban ${symbol} ${res.status}`)
  const html = await res.text()
  const closes = parseChartCloses(html)
  const board = parseBoardFields(html)
  const rets = returnsFromCloses(closes)
  const price = board.lastPrice || board.closePrice || rets.adjClose || null
  const adjusted = Boolean(!rets.stale && (rets.weekPct != null || rets.ytdPct != null))
  return {
    symbol,
    closePrice: board.closePrice || price,
    lastPrice: board.lastPrice || price,
    dailyPct: board.dailyPct,
    weekPct: adjusted ? rets.weekPct : undefined,
    monthPct: adjusted ? rets.monthPct : undefined,
    ytdPct: adjusted ? rets.ytdPct : undefined,
    marketValueBr: board.marketValue != null ? Math.round(board.marketValue / 1e9) : undefined,
    volume: board.volume ?? undefined,
    tradeValueMr: board.tradeValue != null ? Math.round(board.tradeValue / 1e6) : undefined,
    returnsAdjusted: adjusted,
    returnsSource: rets.stale ? 'shakhesban-stale' : 'shakhesban-adjusted-chart',
    candleCount: rets.candleCount || 0,
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
  const { request } = context
  const origin = new URL(request.url).origin
  const cache = typeof caches !== 'undefined' ? caches.default : null

  if (cache) {
    const hit = await cache.match(CACHE_KEY)
    if (hit) {
      const cachedAt = Number(hit.headers.get('x-cached-at') || 0)
      if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) {
        return new Response(hit.body, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=120',
            'x-cache': 'HIT',
          },
        })
      }
    }
  }

  const results = await Promise.allSettled(MINERAL_STOCKS.map((r) => scrapeSymbol(r.symbol)))
  const stocks = []
  const errors = []
  results.forEach((r, i) => {
    const meta = MINERAL_STOCKS[i]
    if (r.status === 'fulfilled') {
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
    ok: stocks.some((s) => s.returnsAdjusted),
    updatedAt: new Date().toISOString(),
    source: 'shakhesban-adjusted-chart',
    stocks,
    errors: errors.slice(0, 8),
  }

  if (!payload.ok) {
    const fallback = await loadStaticFallback(origin)
    if (fallback?.stocks?.length) {
      payload = {
        ok: true,
        updatedAt: fallback.updatedAt || payload.updatedAt,
        source: 'static-mineral_stocks',
        stocks: fallback.stocks,
        errors: payload.errors,
      }
    }
  }

  const body = JSON.stringify(payload)
  const response = new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=120',
      'x-cached-at': String(Date.now()),
      'x-cache': 'MISS',
    },
  })

  if (cache && payload.ok) {
    try {
      await cache.put(CACHE_KEY, response.clone())
    } catch {
      /* ignore cache write */
    }
  }

  return response
}
