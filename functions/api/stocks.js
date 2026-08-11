/**
 * Cloudflare Pages Function: mineral stock snapshots + period returns.
 *
 * Primary: BourseView price history
 *   - قیمت پایانی = vwap (not `close` which is آخرین معامله)
 *   - قیمت تعدیلی = close * adjustingCoef
 *   - week: vs last trading day on/before previous Wednesday
 *   - month: vs last trading day on/before last day of previous Jalali month
 *   - ytd: vs last trading day on/before 01 Farvardin
 *   - halted: volume/value/dailyPct = 0, پایانی = last traded vwap
 *
 * requires env BOURSEVIEW_COOKIE (`authentication=…`)
 * Fallback: SourceArena / static mineral_stocks.json
 * Shakhesban is intentionally NOT used.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SOURCEARENA_API = 'https://apis.sourcearena.ir/api/'
const DEMO_TOKEN = 'bba6d330a87bac533f18cc245d3baeaa'
const BV_BASE = 'https://www.bourseview.com'
const BV_HISTORY_N = 900
const SA_HISTORY_DAYS = 900

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
const CACHE_KEY = 'https://cache.local/mineral-stocks-bv-v11'

/** Manual share-count overrides when quote history lags capital-increase filings. */
const OUTSTANDING_SHARES = {
  فملی: 1_440_000_000_000,
}

/** Pre-increase / post-increase share bases for price adjustment (last trade still pre-split). */
const PRICE_ADJUST_SHARES = {
  فملی: { from: 1_050_000_000_000, to: 1_440_000_000_000 },
}

function num(raw) {
  if (raw == null) return null
  const n = Number(String(raw).replace(/,/g, '').replace(/%/g, '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function pct(from, to) {
  if (from == null || to == null || !(from > 0)) return null
  return Math.round((to / from - 1) * 10000) / 100
}

function jalaliParts(date = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
    const year = Number(String(parts.year).replace(/\D/g, '')) || 1405
    const month = Number(parts.month) || 1
    const day = Number(parts.day) || 1
    return {
      year,
      month,
      day,
      key: `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
    }
  } catch {
    return { year: 1405, month: 1, day: 1, key: '1405/01/01' }
  }
}

function threeYearsAgoJalaliKey(date = new Date()) {
  const j = jalaliParts(date)
  return `${j.year - 3}/${String(j.month).padStart(2, '0')}/${String(j.day).padStart(2, '0')}`
}

function oneYearAgoJalaliKey(date = new Date()) {
  const j = jalaliParts(date)
  return `${j.year - 1}/${String(j.month).padStart(2, '0')}/${String(j.day).padStart(2, '0')}`
}

function tehranWeekdaySat0(date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    weekday: 'short',
  }).format(date)
  const map = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 }
  return map[name] ?? 0
}

function tehranNoonDate() {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return new Date(`${iso}T12:00:00+03:30`)
}

/** چهارشنبهٔ هفتهٔ گذشته (شنبه=۰ … جمعه=۶) */
function previousWednesdayKey() {
  const base = tehranNoonDate()
  const wd = tehranWeekdaySat0(base)
  const daysBack = wd + 3
  return jalaliParts(new Date(base.getTime() - daysBack * 86400000)).key
}

/** آخرین روز ماه شمسی قبل */
function lastDayPrevJalaliMonthKey() {
  const base = tehranNoonDate()
  const cur = jalaliParts(base)
  for (let i = 1; i <= 40; i++) {
    const j = jalaliParts(new Date(base.getTime() - i * 86400000))
    if (j.year !== cur.year || j.month !== cur.month) return j.key
  }
  return cur.key
}

function jalaliYearStartKey() {
  const y = jalaliParts().year
  return `${y}/01/01`
}

function normShamsi(raw) {
  if (!raw) return ''
  const m = String(raw)
    .replace(/-/g, '/')
    .match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/)
  if (!m) return ''
  return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`
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
  const yStart = jalaliYearStartKey()
  const ytdRows = closes.filter((c) => c.date >= yStart)
  const ytdBase = ytdRows.length ? ytdRows[ytdRows.length - 1].price : null
  const y1Key = oneYearAgoJalaliKey()
  const y3Key = threeYearsAgoJalaliKey()
  const y1Rows = closes.filter((c) => c.date >= y1Key)
  const y3Rows = closes.filter((c) => c.date >= y3Key)
  const year1Base = y1Rows.length ? y1Rows[y1Rows.length - 1].price : closes[closes.length - 1]?.price
  const year3Base = y3Rows.length ? y3Rows[y3Rows.length - 1].price : closes[closes.length - 1]?.price

  return {
    weekPct: pct(week, last),
    monthPct: pct(month, last),
    ytdPct: pct(ytdBase, last),
    year1Pct: pct(year1Base, last),
    year3Pct: pct(year3Base, last),
    lastPrice: last,
    historyCount: closes.length,
  }
}

/** First trading row on/before target shamsi (items newest-first). */
function adjOnOrBefore(traded, targetKey) {
  for (const row of traded) {
    if (row.shamsi && row.shamsi <= targetKey && row.adj > 0) return row
  }
  return null
}

function returnsFromBvItems(items, currentPayani) {
  const traded = []
  for (const row of items) {
    const close = num(row?.close)
    if (close == null || !(close > 0)) continue
    const coef = num(row?.adjustingCoef)
    const adj = close * (coef != null && coef > 0 ? coef : 1)
    const shamsi = normShamsi(row?.shamsiDate)
    const vwap = num(row?.vwap)
    traded.push({ shamsi, close, adj, vwap, volume: num(row?.volume) || 0 })
  }
  if (!traded.length) return { historyCount: 0 }

  const weekBase = adjOnOrBefore(traded, previousWednesdayKey())
  const monthBase = adjOnOrBefore(traded, lastDayPrevJalaliMonthKey())
  const ytdBase = adjOnOrBefore(traded, jalaliYearStartKey())
  const year1Base = adjOnOrBefore(traded, oneYearAgoJalaliKey())
  const year3Base = adjOnOrBefore(traded, threeYearsAgoJalaliKey())

  return {
    weekPct: pct(weekBase?.adj, currentPayani),
    monthPct: pct(monthBase?.adj, currentPayani),
    ytdPct: pct(ytdBase?.adj, currentPayani),
    year1Pct: pct(year1Base?.adj, currentPayani),
    year3Pct: pct(year3Base?.adj, currentPayani),
    historyCount: traded.length,
    anchors: {
      week: weekBase?.shamsi || null,
      month: monthBase?.shamsi || null,
      ytd: ytdBase?.shamsi || null,
      year1: year1Base?.shamsi || null,
      year3: year3Base?.shamsi || null,
      weekAdj: weekBase?.adj ?? null,
      monthAdj: monthBase?.adj ?? null,
      ytdAdj: ytdBase?.adj ?? null,
      year1Adj: year1Base?.adj ?? null,
      year3Adj: year3Base?.adj ?? null,
    },
  }
}

function bvHeaders(cookie) {
  return {
    Cookie: cookie,
    Accept: 'application/json',
    'User-Agent': UA,
    Referer: 'https://www.bourseview.com/',
    Origin: 'https://www.bourseview.com',
  }
}

async function bvFetchQuotes(cookie, idToken, exchange, isin, attempts = 3) {
  const url = `${BV_BASE}/api/v2/exchanges/${exchange}/stocks/${isin}/quotes?timeFrame=daily&lastN=${BV_HISTORY_N}&expand=shamsiDate,individual-detail`
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: bvHeaders(cookie),
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

async function bvFetchStockMeta(cookie, idToken, exchange, isin) {
  const url = `${BV_BASE}/api/v2/exchanges/${exchange}/stocks/${isin}`
  const res = await fetch(url, {
    headers: bvHeaders(cookie),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`bourseview meta ${res.status}`)
  return res.json()
}

function detailValue(item, code) {
  const details = item?.detail
  if (!Array.isArray(details)) return null
  const hit = details.find((d) => d && d.code === code)
  return num(hit?.value)
}

function snapFromBv(meta, items, stockMeta = null) {
  const head = items[0] || {}
  const tradedHead = items.find((r) => num(r?.close) != null && num(r.close) > 0)
  const halted = !(num(head?.close) > 0)

  // قیمت پایانی نمایشی = vwap؛ برای نماد متوقف: آخرین پایانیِ روز معاملاتی
  const closePrice = halted
    ? num(tradedHead?.vwap) || num(tradedHead?.close)
    : num(head.vwap) || num(tradedHead?.vwap) || num(tradedHead?.close)

  // صورت کسر بازدهی روی مقیاس تعدیلی (vwap×coef آخرین معامله)
  const lastCoef = num(tradedHead?.adjustingCoef)
  const lastVwap = num(tradedHead?.vwap) || num(tradedHead?.close)
  const currentForReturn =
    lastVwap != null
      ? lastVwap * (lastCoef != null && lastCoef > 0 ? lastCoef : 1)
      : closePrice

  const rets = returnsFromBvItems(items, currentForReturn)

  // خالص خرید حقیقی (ریال) → میلیارد تومان
  const netIndRial = detailValue(halted ? tradedHead : head, 'netIndividual')
  const netIndividualBt =
    netIndRial != null ? Math.round((netIndRial / 1e10) * 100) / 100 : null

  // Last 7 trading days of net individual flow (oldest → newest), billion toman
  const tradedDays = items.filter((r) => num(r?.close) != null && num(r.close) > 0)
  const weekSlice = tradedDays.slice(0, 7).reverse()
  const netIndividualWeekBt = weekSlice
    .map((r) => {
      const v = detailValue(r, 'netIndividual')
      return v != null ? Math.round((v / 1e10) * 100) / 100 : null
    })
    .filter((v) => v != null)

  let dailyPct = null
  let volume = 0
  let tradeValueMr = 0
  let marketValueBr

  if (halted) {
    dailyPct = 0
    volume = 0
    tradeValueMr = 0
    const mv = num(tradedHead?.marketCap) || num(head?.marketCap)
    marketValueBr = mv != null ? Math.round(mv / 1e9) : undefined
  } else {
    const vwap = num(head.vwap)
    const prev = num(head.previousVwap)
    dailyPct = pct(prev, vwap)
    volume = num(head.volume) || 0
    const tv = num(head.value)
    tradeValueMr = tv != null ? Math.round(tv / 1e6) : 0
    const mv = num(head.marketCap)
    marketValueBr = mv != null ? Math.round(mv / 1e9) : undefined
  }

  const freeFloat =
    num(halted ? tradedHead?.freeFloat : head.freeFloat) ?? num(tradedHead?.freeFloat) ?? null
  let outstanding =
    num(stockMeta?.numberOfOutstandingShares) ||
    num(halted ? tradedHead?.numberOfOutstandingShares : head.numberOfOutstandingShares) ||
    num(tradedHead?.numberOfOutstandingShares) ||
    null
  const overrideShares = OUTSTANDING_SHARES[meta.symbol]
  if (overrideShares) outstanding = overrideShares

  // Quote marketCap / last price often lag capital-increase filings.
  // Adjust price by old/new share base, then MV = adjPrice × shares.
  let priceForMv = closePrice
  const adj = PRICE_ADJUST_SHARES[meta.symbol]
  if (closePrice != null && adj?.from > 0 && adj?.to > 0) {
    priceForMv = closePrice * (adj.from / adj.to)
  }
  if (priceForMv != null && outstanding != null && outstanding > 0) {
    marketValueBr = Math.round((priceForMv * outstanding) / 1e9)
  }

  // BV freeFloat is a fraction (e.g. 0.23); volume / (float×shares) × 100
  let volumeToFloatPct = null
  if (volume > 0 && freeFloat != null && freeFloat > 0 && outstanding != null && outstanding > 0) {
    const floatShares = freeFloat * outstanding
    if (floatShares > 0) volumeToFloatPct = Math.round((volume / floatShares) * 10000) / 100
  }

  return {
    symbol: meta.symbol,
    closePrice,
    lastPrice: closePrice,
    dailyPct,
    weekPct: rets.weekPct,
    monthPct: rets.monthPct,
    ytdPct: rets.ytdPct,
    year1Pct: rets.year1Pct,
    year3Pct: rets.year3Pct,
    marketValueBr,
    volume,
    tradeValueMr,
    netIndividualBt: halted ? 0 : netIndividualBt,
    netIndividualWeekBt,
    freeFloatPct: freeFloat != null ? Math.round(freeFloat * 10000) / 100 : null,
    outstandingShares: outstanding,
    volumeToFloatPct: halted ? 0 : volumeToFloatPct,
    returnsAdjusted: true,
    returnsSource: 'bourseview-adjusted',
    historyCount: rets.historyCount || 0,
    halted,
    anchors: rets.anchors,
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
    year1Pct: rets.year1Pct,
    year3Pct: rets.year3Pct,
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
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.has('refresh') || url.searchParams.has('fresh')
  const token = (env?.SOURCEARENA_TOKEN || DEMO_TOKEN).trim()
  const bvCookie = normalizeCookie(env?.BOURSEVIEW_COOKIE || env?.BOURSEVIEW_TOKEN || '')
  const bvIdToken = String(env?.BOURSEVIEW_ID_TOKEN || '').trim()
  const cache = typeof caches !== 'undefined' ? caches.default : null
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=60',
    'access-control-allow-origin': '*',
  }

  // Static-first: never block SPA on a slow BourseView scrape.
  let staticBundle = null
  try {
    staticBundle = await loadStaticFallback(origin)
  } catch {
    /* ignore */
  }
  const staticFlowOk = Boolean(
    staticBundle?.stocks?.some(
      (s) => Array.isArray(s.netIndividualWeekBt) && s.netIndividualWeekBt.length >= 5,
    ),
  )
  // The bundled snapshot is only a no-credential fallback. When BourseView is
  // configured, continue to the live cache/scrape instead of freezing the SPA
  // on the original PDF-era table.
  if (false && !forceRefresh && !bvCookie && staticBundle?.stocks?.length && staticFlowOk) {
    return new Response(
      JSON.stringify({
        ...staticBundle,
        ok: true,
        updatedAt: staticBundle.updatedAt || new Date().toISOString(),
        served: 'static-fast',
        note: staticBundle.note || 'static mineral_stocks (ورود پول از snapshot)',
      }),
      { headers },
    )
  }

  if (cache && !forceRefresh) {
    const hit = await cache.match(CACHE_KEY)
    if (hit) {
      const cachedAt = Number(hit.headers.get('x-cached-at') || 0)
      if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) {
        return new Response(hit.body, {
          headers: {
            ...headers,
            'x-cached-at': String(cachedAt),
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
      const needMeta = Boolean(OUTSTANDING_SHARES[meta.symbol] || PRICE_ADJUST_SHARES[meta.symbol])
      const [items, stockMeta] = await Promise.all([
        bvFetchQuotes(bvCookie, bvIdToken, meta.exchange, meta.isin),
        needMeta
          ? bvFetchStockMeta(bvCookie, bvIdToken, meta.exchange, meta.isin).catch(() => null)
          : Promise.resolve(null),
      ])
      return snapFromBv(meta, items, stockMeta)
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
  const needSa = false
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
  let ordered = MINERAL_STOCKS.map(
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
    note = 'بازدهی = قیمت پایانی (vwap) نسبت به قیمت تعدیلی تاریخچه بورس‌ویو'
  } else if (adjustedCount > 0) {
    source = 'sourcearena-adjusted'
    note = 'بازدهی از قیمت تعدیل‌شده SourceArena'
  }

  // Fill remaining error stubs from last good static snapshot (expired/partial BV cookie).
  const badCount = ordered.filter(
    (s) => s.returnsSource === 'error' || !(s.ytdPct != null || s.closePrice != null || s.historyCount > 0),
  ).length
  if (false && badCount > 0) {
    const fallback = await loadStaticFallback(origin)
    if (fallback?.stocks?.length) {
      const fbBy = new Map(fallback.stocks.map((s) => [s.symbol, s]))
      ordered = ordered.map((s) => {
        if (s.returnsSource !== 'error' && (s.historyCount > 0 || s.closePrice != null || s.ytdPct != null)) {
          return s
        }
        const fb = fbBy.get(s.symbol)
        return fb ? { ...fb, name: s.name || fb.name } : s
      })
      const usable = ordered.filter(
        (s) => s.returnsSource !== 'error' && (s.ytdPct != null || s.closePrice != null),
      )
      if (usable.length < Math.max(8, Math.floor(MINERAL_STOCKS.length * 0.5))) {
        ordered = fallback.stocks
        source = fallback.source || 'static-mineral_stocks'
        note = 'fallback static — کوکی بورس‌ویو منقضی یا از دستگاه دیگر لاگین شده'
      } else if (bvOk === 0) {
        source = fallback.source || source
        note = 'fallback static — کوکی بورس‌ویو منقضی یا از دستگاه دیگر لاگین شده'
      } else if (badCount > 0) {
        note = `${note} · ${badCount} نماد از snapshot استاتیک`
      }
    }
  }

  const bourseviewRows = ordered.filter(
    (s) => s.returnsSource === 'bourseview-adjusted' && (s.historyCount > 0 || s.closePrice != null),
  )
  const payload = {
    ok: bvOk > 0,
    updatedAt: new Date().toISOString(),
    source: 'bourseview-adjusted',
    note: 'داده زنده و بازدهی تعدیل‌شده، فقط از بورس‌ویو',
    bourseviewReady: Boolean(bvCookie),
    bourseviewOk: bvOk,
    stocks: bourseviewRows,
    errors: errors.slice(0, 12),
  }

  const body = JSON.stringify(payload)
  const response = new Response(body, {
    status: 200,
    headers: {
      ...headers,
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
