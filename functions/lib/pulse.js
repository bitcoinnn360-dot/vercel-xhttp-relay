/**
 * TradersArena live pulse + durable history helpers.
 * Source: https://tradersarena.ir/data/market
 * Industries: https://tradersarena.ir/data/industries  (field `t` = net retail flow, rial)
 *
 * History is merged from:
 *  1) Cloudflare Cache API (edge, best-effort)
 *  2) Static /data/market_pulse.json (last deploy)
 *  3) GitHub raw pulse-data branch (cron collector)
 */
const TA_MARKET = 'https://tradersarena.ir/data/market'
const TA_INDUSTRIES = 'https://tradersarena.ir/data/industries'
const RIAL_PER_BILLION_TOMAN = 1e10
const RIAL_PER_MILLION_TOMAN = 1e7
const PULSE_CACHE_URL = 'https://pulse-cache.internal/market-pulse-v5'
const PULSE_CACHE_URL_LEGACY = [
  'https://pulse-cache.internal/market-pulse-v4',
  'https://pulse-cache.internal/market-pulse-v3',
  'https://pulse-cache.internal/market-pulse-v2',
]
/** Cash market ends ~12:30; commodity gold ETFs keep trading into the afternoon (≈17:00). */
export const PULSE_HIST_START = '09:00'
export const PULSE_CASH_END = '12:30'
export const PULSE_HIST_END = '17:00'
const MAX_DAY_ARCHIVE = 45
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Raw JSON written by GitHub Actions cron (scripts/collect_pulse.py). */
export const PULSE_REMOTE_URLS = [
  'https://raw.githubusercontent.com/bitcoinnn360-dot/vercel-xhttp-relay/pulse-data/public/data/market_pulse.json',
  'https://raw.githubusercontent.com/bitcoinnn360-dot/vercel-xhttp-relay/pulse-data/market_pulse.json',
  'https://cdn.jsdelivr.net/gh/bitcoinnn360-dot/vercel-xhttp-relay@pulse-data/public/data/market_pulse.json',
]

/** Industry ids on TradersArena industries table. */
const INDUSTRY_FLOW_IDS = {
  basicMetals: '27',
  metalOres: '13',
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

export function clampPulseHistoryTime(hhmm) {
  const t = String(hhmm || '')
  if (!/^\d{2}:\d{2}$/.test(t)) return null
  if (t < PULSE_HIST_START) return null
  if (t > PULSE_HIST_END) return PULSE_HIST_END
  return t
}

export function pulsePointFromSnapshot(pulse) {
  if (!pulse) return null
  const time = clampPulseHistoryTime(pulse.time) || PULSE_HIST_END
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
    time: clampPulseHistoryTime(today.time) || (today.time > PULSE_HIST_END ? PULSE_HIST_END : today.time),
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

function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') {
    return { dateJalali: null, history: [], days: {}, current: null }
  }
  const days = raw.days && typeof raw.days === 'object' ? { ...raw.days } : {}
  const dateJalali = raw.dateJalali || null
  let history = Array.isArray(raw.history) ? raw.history : []
  if (dateJalali && (!history.length) && Array.isArray(days[dateJalali])) {
    history = days[dateJalali]
  }
  if (dateJalali && history.length && !days[dateJalali]) {
    days[dateJalali] = history
  }
  return {
    dateJalali,
    history,
    days,
    current: raw.current || null,
    updatedAt: raw.updatedAt || null,
  }
}

function historyScore(store) {
  const h = store?.history
  return Array.isArray(h) ? h.length : 0
}

/** Prefer the store with the denser same-day history. */
export function pickRicherStore(a, b) {
  const A = normalizeStore(a)
  const B = normalizeStore(b)
  if (!A.dateJalali) return B
  if (!B.dateJalali) return A
  if (A.dateJalali !== B.dateJalali) {
    // keep both days in archive; prefer today's active history
    const today = jalaliTodayTehran().dateJalali
    const primary = A.dateJalali === today ? A : B.dateJalali === today ? B : historyScore(A) >= historyScore(B) ? A : B
    const other = primary === A ? B : A
    const days = { ...(other.days || {}), ...(primary.days || {}) }
    if (other.dateJalali && other.history?.length) days[other.dateJalali] = other.history
    if (primary.dateJalali && primary.history?.length) days[primary.dateJalali] = primary.history
    return { ...primary, days }
  }
  const days = { ...(A.days || {}), ...(B.days || {}) }
  const mergedHist = mergeHistoryLists(A.history, B.history)
  days[A.dateJalali] = mergedHist
  const current =
    (A.updatedAt || '') >= (B.updatedAt || '') ? A.current || B.current : B.current || A.current
  return {
    dateJalali: A.dateJalali,
    history: mergedHist,
    days,
    current,
    updatedAt: (A.updatedAt || '') >= (B.updatedAt || '') ? A.updatedAt : B.updatedAt,
  }
}

export function mergeHistoryLists(...lists) {
  const byTime = new Map()
  for (const list of lists) {
    for (const p of list || []) {
      if (!p?.time) continue
      const t = clampPulseHistoryTime(String(p.time))
      if (!t) continue
      byTime.set(t, { ...byTime.get(t), ...p, time: t })
    }
  }
  return [...byTime.values()]
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .slice(-480)
}

async function tryMatchCache(cache, url) {
  try {
    if (!cache) return null
    const hit = await cache.match(url)
    if (!hit) return null
    const json = await hit.json()
    return json && typeof json === 'object' ? normalizeStore(json) : null
  } catch {
    return null
  }
}

export async function fetchRemotePulseStore() {
  for (const url of PULSE_REMOTE_URLS) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        cf: { cacheTtl: 30, cacheEverything: true },
      })
      if (!res.ok) continue
      const json = await res.json()
      if (json && typeof json === 'object') return normalizeStore(json)
    } catch {
      /* try next */
    }
  }
  return null
}

export async function loadPulseStore(cache, fallback = null) {
  const empty = { dateJalali: null, history: [], days: {}, current: null }
  let store = empty

  const primary = await tryMatchCache(cache, PULSE_CACHE_URL)
  if (primary) store = pickRicherStore(store, primary)

  for (const url of PULSE_CACHE_URL_LEGACY) {
    const legacy = await tryMatchCache(cache, url)
    if (legacy) store = pickRicherStore(store, legacy)
  }

  if (fallback && typeof fallback === 'object') {
    store = pickRicherStore(store, normalizeStore(fallback))
  }

  const remote = await fetchRemotePulseStore()
  if (remote) store = pickRicherStore(store, remote)

  return store.dateJalali || historyScore(store) ? store : empty
}

export async function savePulseStore(cache, store) {
  if (!cache) return
  try {
    const normalized = normalizeStore(store)
    // keep archive trimmed
    const days = { ...(normalized.days || {}) }
    const keys = Object.keys(days).sort()
    if (keys.length > MAX_DAY_ARCHIVE) {
      for (const k of keys.slice(0, keys.length - MAX_DAY_ARCHIVE)) delete days[k]
    }
    if (normalized.dateJalali && normalized.history?.length) {
      days[normalized.dateJalali] = normalized.history
    }
    const payload = { ...normalized, days, updatedAt: new Date().toISOString() }
    await cache.put(
      PULSE_CACHE_URL,
      new Response(JSON.stringify(payload), {
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

export function mergePulseHistory(store, pulse, { maxPoints = 720 } = {}) {
  const today = pulse?.dateJalali || jalaliTodayTehran().dateJalali
  const prev = normalizeStore(store)
  const days = { ...(prev.days || {}) }

  let history =
    prev.dateJalali === today
      ? [...(prev.history || [])]
      : [...(days[today] || [])]

  if (prev.dateJalali && prev.dateJalali !== today && prev.history?.length) {
    days[prev.dateJalali] = prev.history
  }

  const point = pulsePointFromSnapshot(pulse)
  const t = clampPulseHistoryTime(point?.time)
  if (point && t) {
    point.time = t
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

  days[today] = history
  const keys = Object.keys(days).sort()
  if (keys.length > MAX_DAY_ARCHIVE) {
    for (const k of keys.slice(0, keys.length - MAX_DAY_ARCHIVE)) delete days[k]
  }

  return {
    dateJalali: today,
    history,
    days,
    current: pulse,
    updatedAt: new Date().toISOString(),
  }
}

/** History for a Jalali day (today by default). */
export function historyForDay(store, dateJalali) {
  const s = normalizeStore(store)
  const day = dateJalali || s.dateJalali || jalaliTodayTehran().dateJalali
  if (s.dateJalali === day && s.history?.length) return s.history
  return Array.isArray(s.days?.[day]) ? s.days[day] : []
}
