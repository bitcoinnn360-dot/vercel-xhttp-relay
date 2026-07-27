/**
 * TradersArena live pulse + Cloudflare Cache history helpers.
 * Source: https://tradersarena.ir/data/market
 * Industries: https://tradersarena.ir/data/industries  (field `t` = net retail flow, rial)
 *
 * `o` ≈ [فروش ۵خط, خرید ۵خط, فروش صف, خرید صف] (ریال)
 * `m[2]`/`m[3]` ≈ سرانه خرید/فروش حقیقی (ریال)
 * `m[5]` ≈ خالص ورود پول حقیقی کل بازار (ریال)
 * `st[5]` / `sf[5]` / `nsf[5]` ≈ ورود پول سهام+حق‌تقدم / ص.سهامی / ص.درآمدثابت
 * `pp`/`pm` ≈ تعداد نماد مثبت/منفی
 */
const TA_MARKET = 'https://tradersarena.ir/data/market'
const TA_INDUSTRIES = 'https://tradersarena.ir/data/industries'
const RIAL_PER_BILLION_TOMAN = 1e10
const RIAL_PER_MILLION_TOMAN = 1e7
const PULSE_CACHE_URL = 'https://pulse-cache.internal/market-pulse-v4'
const PULSE_CACHE_URL_LEGACY = [
  'https://pulse-cache.internal/market-pulse-v3',
  'https://pulse-cache.internal/market-pulse-v2',
]
/** Cash-market session window (Tehran). After close, ticks update the end slot. */
const PULSE_HIST_START = '08:45'
const PULSE_HIST_END = '12:30'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Industry ids on TradersArena industries table (bottom of tradersarena.ir). */
const INDUSTRY_FLOW_IDS = {
  basicMetals: '27', // فلزات اساسی
  metalOres: '13', // استخراج کانه های فلزی
  // کل ورود پول حقیقی گروه «صندوق های طلا و سکه» (زیر صندوق‌های سهامی در جدول صنایع)
  goldFunds: 'gold-funds',
}

export function jalaliTodayTehran() {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (t) => parts.find((p) => p.type === t)?.value
  let y = get('year')
  if (y && /[^\d]/.test(y)) {
    const map = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' }
    y = y.replace(/[۰-۹]/g, (d) => map[d] || d)
  }
  const mo = get('month')
  const d = get('day')
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return {
    dateJalali: `${y}/${mo}/${d}`,
    dateGregorian: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' }),
    time: timeFmt.format(new Date()),
  }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function bt(rial) {
  if (rial == null || !Number.isFinite(Number(rial))) return null
  return round1(Number(rial) / RIAL_PER_BILLION_TOMAN)
}

function mt(rial) {
  if (rial == null || !Number.isFinite(Number(rial))) return null
  return round2(Number(rial) / RIAL_PER_MILLION_TOMAN)
}

function segFlow(arr) {
  if (!Array.isArray(arr) || arr.length < 6) return null
  return bt(arr[5])
}

export function parseIndustryFlows(rows) {
  const out = {
    flowBasicMetalsBillionToman: null,
    flowMetalOresBillionToman: null,
    flowGoldFundsBillionToman: null,
  }
  if (!Array.isArray(rows)) return out
  const byId = new Map()
  for (const row of rows) {
    if (!row || row.a == null) continue
    byId.set(String(row.a), row)
  }
  const pick = (id) => {
    const row = byId.get(id)
    if (!row) return null
    return bt(row.t)
  }
  out.flowBasicMetalsBillionToman = pick(INDUSTRY_FLOW_IDS.basicMetals)
  out.flowMetalOresBillionToman = pick(INDUSTRY_FLOW_IDS.metalOres)
  out.flowGoldFundsBillionToman = pick(INDUSTRY_FLOW_IDS.goldFunds)
  return out
}

function clampPulseHistoryTime(hhmm) {
  const t = String(hhmm || '')
  if (!/^\d{2}:\d{2}$/.test(t)) return null
  if (t < PULSE_HIST_START) return null
  if (t > PULSE_HIST_END) return PULSE_HIST_END
  return t
}

export function pulsePointFromSnapshot(pulse) {
  if (!pulse) return null
  const time = clampPulseHistoryTime(pulse.time) || pulse.time
  return {
    time,
    positive: pulse.breadth?.positive,
    negative: pulse.breadth?.negative,
    flat: pulse.breadth?.flat,
    orderBuy: pulse.orderBuyBillionToman,
    orderSell: pulse.orderSellBillionToman,
    retailFlow: pulse.retailMoneyFlowBillionToman,
    flowStocks: pulse.flowStocksBillionToman,
    flowEquityFunds: pulse.flowEquityFundsBillionToman,
    flowFixedIncome: pulse.flowFixedIncomeBillionToman,
    flowBasicMetals: pulse.flowBasicMetalsBillionToman,
    flowMetalOres: pulse.flowMetalOresBillionToman,
    flowGoldFunds: pulse.flowGoldFundsBillionToman,
    perCapitaBuy: pulse.perCapitaBuyMillionToman,
    perCapitaSell: pulse.perCapitaSellMillionToman,
  }
}

export function parseTradersArenaMarket(data, industryFlows = null) {
  if (!data || typeof data !== 'object') return null
  const today = jalaliTodayTehran()
  const o = Array.isArray(data.o) ? data.o : []
  const m = Array.isArray(data.m) ? data.m : []
  const st = Array.isArray(data.st) ? data.st : []
  const sf = Array.isArray(data.sf) ? data.sf : []
  const nsf = Array.isArray(data.nsf) ? data.nsf : []
  const pp = Array.isArray(data.pp) ? data.pp[0] : data.pp
  const pm = Array.isArray(data.pm) ? data.pm[0] : data.pm
  const positive = Number(pp) || 0
  const negative = Number(pm) || 0
  const xyz = Array.isArray(data.xyz) ? data.xyz : []
  const flat = Math.max(0, Number(xyz[1]) || 0)

  const orderSell = bt(o[0])
  const orderBuy = bt(o[1])
  const orderSellQueue = bt(o[2])
  const orderBuyQueue = bt(o[3])

  const flowStocks = segFlow(st)
  const flowEquityFunds = segFlow(sf)
  const flowFixedIncome = segFlow(nsf)
  const ind = industryFlows || {}

  return {
    asOf: new Date().toISOString(),
    time: today.time,
    dateJalali: data.j || today.dateJalali,
    source: 'tradersarena',
    breadth: {
      positive,
      negative,
      flat,
      total: positive + negative + flat,
    },
    orderBuyBillionToman: orderBuy,
    orderSellBillionToman: orderSell,
    orderBuyQueueBillionToman: orderBuyQueue,
    orderSellQueueBillionToman: orderSellQueue,
    retailMoneyFlowBillionToman: bt(m[5]),
    flowStocksBillionToman: flowStocks,
    flowEquityFundsBillionToman: flowEquityFunds,
    flowFixedIncomeBillionToman: flowFixedIncome,
    flowBasicMetalsBillionToman: ind.flowBasicMetalsBillionToman ?? null,
    flowMetalOresBillionToman: ind.flowMetalOresBillionToman ?? null,
    flowGoldFundsBillionToman: ind.flowGoldFundsBillionToman ?? null,
    // m[1] = ارزش معاملات کل بازار (ریال) → همت
    totalTradeValueHmt:
      m[1] != null && Number.isFinite(Number(m[1]))
        ? Math.round((Number(m[1]) / 1e13) * 100) / 100
        : null,
    totalTradeValueBillionToman: bt(m[1]),
    retailBuyBillionToman: bt(m[7]),
    retailSellBillionToman: bt(m[10]),
    perCapitaBuyMillionToman: mt(m[2]),
    perCapitaSellMillionToman: mt(m[3]),
    buyPower: Number.isFinite(Number(m[4])) ? Number(m[4]) : null,
    note: 'داده زنده TradersArena · ورود پول بازار + صنایع',
  }
}

async function fetchTaJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': UA,
      Referer: 'https://tradersarena.ir/',
    },
  })
  if (!res.ok) throw new Error(`tradersarena ${url} ${res.status}`)
  return res.json()
}

export async function fetchTradersArenaPulse() {
  const [market, industries] = await Promise.all([
    fetchTaJson(TA_MARKET),
    fetchTaJson(TA_INDUSTRIES).catch(() => null),
  ])
  const industryFlows = parseIndustryFlows(industries)
  const pulse = parseTradersArenaMarket(market, industryFlows)
  if (!pulse) throw new Error('tradersarena empty')
  return pulse
}

export async function loadPulseStore(cache, fallback = null) {
  const empty = { dateJalali: null, history: [], current: null }
  const tryMatch = async (url) => {
    try {
      if (!cache) return null
      const hit = await cache.match(url)
      if (!hit) return null
      const json = await hit.json()
      return json && typeof json === 'object' ? json : null
    } catch {
      return null
    }
  }
  const primary = await tryMatch(PULSE_CACHE_URL)
  if (primary?.history?.length) return primary
  for (const url of PULSE_CACHE_URL_LEGACY) {
    const legacy = await tryMatch(url)
    if (legacy?.history?.length) {
      return { ...legacy, migratedFrom: url }
    }
  }
  if (primary) return primary
  return fallback && typeof fallback === 'object' ? fallback : empty
}

export async function savePulseStore(cache, store) {
  if (!cache) return
  try {
    await cache.put(
      PULSE_CACHE_URL,
      new Response(JSON.stringify(store), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
        },
      }),
    )
  } catch {
    /* ignore */
  }
}

export function mergePulseHistory(store, pulse, { maxPoints = 480 } = {}) {
  const today = pulse?.dateJalali || jalaliTodayTehran().dateJalali
  let base =
    store && store.dateJalali === today
      ? store
      : { dateJalali: today, history: [], current: null }
  const point = pulsePointFromSnapshot(pulse)
  let history = Array.isArray(base.history) ? [...base.history] : []
  const t = clampPulseHistoryTime(point?.time)
  if (point && t) {
    point.time = t
    // replace same minute (incl. after-hours updates to end slot)
    history = history.filter((h) => h?.time !== t)
    history.push(point)
    history = history
      .filter((h) => {
        const ht = String(h?.time || '')
        return ht >= PULSE_HIST_START && ht <= PULSE_HIST_END
      })
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .slice(-maxPoints)
  }
  return {
    dateJalali: today,
    history,
    current: pulse,
    updatedAt: new Date().toISOString(),
  }
}
