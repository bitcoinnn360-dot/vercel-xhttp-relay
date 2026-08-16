import type {
  CandlePoint,
  CommodityQuote,
  DashboardData,
  GlobalMarketsBundle,
  FinancialsBundle,
  ProductionOpsBundle,
  SourceStatus,
  StockRow,
} from './types'
import { seedDashboard } from './seed'
import { MINERAL_SYMBOL_BY_NAME } from './mineralUniverse'

const TGJU_AJAX = 'https://call2.tgju.org/ajax.json'
const TGJU_HIST = 'https://api.tgju.org/v1/market/indicator/summary-table-data'

const LIVE_QUOTE_KEYS: { key: string; id: string; name?: string }[] = [
  { key: 'bourse', id: 'bourse' },
  { key: 'price_dollar_rl', id: 'price_dollar_rl' },
  { key: 'ons', id: 'ons' },
  { key: 'sekee', id: 'sekee' },
  { key: 'copper', id: 'copper' },
  { key: 'aluminium', id: 'aluminium' },
  { key: 'zinc', id: 'zinc' },
  { key: 'oil_brent', id: 'oil_brent' },
  { key: 'crypto-bitcoin', id: 'crypto-bitcoin' },
  { key: 'base-us-iron-ore', id: 'base-us-iron-ore' },
  { key: 'base-us-steel-coil', id: 'base-us-steel-coil' },
  { key: 'energy-natural-gas', id: 'energy-natural-gas' },
]

const HIST_KEYS = [
  'bourse',
  'ons',
  'price_dollar_rl',
  'sekee',
  'copper',
  'aluminium',
  'zinc',
  'oil_brent',
  'crypto-bitcoin',
  'base-us-iron-ore',
  'base-us-steel-coil',
]

const FRED_SERIES: { id: string; label: string; mapTo?: string }[] = [
  { id: 'DCOILBRENTEU', label: 'نفت برنت (FRED)', mapTo: 'oil_brent' },
  { id: 'PIORECRUSDM', label: 'سنگ‌آهن FRED', mapTo: 'fred_iron_ore' },
  { id: 'PCOPPUSDM', label: 'مس FRED', mapTo: 'fred_copper' },
  { id: 'DTWEXBGS', label: 'شاخص دلار', mapTo: 'fred_dxy' },
  { id: 'DGS10', label: 'اوراق ۱۰ساله آمریکا', mapTo: 'fred_dgs10' },
]

function parseFaNumber(raw: string | number | null | undefined): number {
  if (raw == null) return NaN
  const cleaned = String(raw).replace(/,/g, '').replace(/[^\d.-]/g, '')
  return Number(cleaned)
}

/** Abortable fetch so a hung Pages Function cannot block the whole dashboard. */
async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export interface HistoryPoint {
  date: string
  dateJalali?: string
  value: number
}

interface RetailMoneyFlowHistory {
  source?: string
  sourceFile?: string
  unit?: string
  firstDateJalali?: string | null
  throughDateJalali?: string | null
  rowCount?: number
  series?: { date: string; value: number }[]
}

async function fetchRetailMoneyFlowHistory(): Promise<RetailMoneyFlowHistory | null> {
  try {
    const res = await fetchWithTimeout('/data/retail_money_flow_daily.json', 5000, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as RetailMoneyFlowHistory
    if (!Array.isArray(json.series) || !json.series.length) return null
    return json
  } catch {
    return null
  }
}

function applyRetailMoneyFlowHistory(base: DashboardData, history: RetailMoneyFlowHistory | null) {
  if (!history?.series?.length) return false

  const rows = new Map<string, number>()
  for (const row of history.series) {
    const date = String(row.date || '').trim()
    const value = Number(row.value)
    if (/^14\d{2}\/\d{2}\/\d{2}$/.test(date) && Number.isFinite(value)) rows.set(date, value)
  }
  if (!rows.size) return false

  const overview = base.overview
  const sources = { ...(overview.fieldSources || {}) }
  const currentDate = overview.marketPulse?.dateJalali || overview.dateJalali
  const hasExactToday = Boolean(
    sources.retailMoneyFlowDaily === 'tradersarena-equity' &&
    currentDate &&
    overview.retailMoneyFlowDaily != null &&
    Number.isFinite(overview.retailMoneyFlowDaily),
  )

  if (hasExactToday && currentDate) rows.set(currentDate, Number(overview.retailMoneyFlowDaily))

  overview.moneyFlowSeries = [...rows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }))
  overview.retailMoneyFlowYtd = overview.moneyFlowSeries.reduce((sum, row) => sum + row.value, 0)
  sources.moneyFlowSeries = hasExactToday ? 'user-excel+tradersarena-equity' : 'user-excel'
  sources.retailMoneyFlowYtd = sources.moneyFlowSeries
  overview.fieldSources = sources
  return true
}

export interface FredBundle {
  id: string
  label: string
  last: number | null
  changePct: number
  history: HistoryPoint[]
}

/** Snapshot of a mineral equity with adjusted period returns (from Shakhesban chart). */
export interface MineralStockSnap {
  symbol: string
  name?: string
  closePrice?: number
  lastPrice?: number
  dailyPct?: number
  weekPct?: number
  monthPct?: number
  ytdPct?: number
  year1Pct?: number
  year3Pct?: number
  marketValueBr?: number
  volume?: number
  tradeValueMr?: number
  /** خالص خرید حقیقی — میلیارد تومان */
  netIndividualBt?: number
  netIndividualWeekBt?: number[]
  freeFloatPct?: number
  outstandingShares?: number
  volumeToFloatPct?: number
  returnsAdjusted?: boolean
  returnsSource?: string
  candleCount?: number
  halted?: boolean
}

export interface IntradayPoint {
  time: string
  value: number
  change?: number | null
}

export interface LiveBundle {
  data: DashboardData
  histories: Record<string, HistoryPoint[]>
  candles: Record<string, CandlePoint[]>
  fred: Record<string, FredBundle>
  sectors: { name: string; color: string; count: number; avgChangePct: number; members: string[] }[]
  scrapeMeta: {
    updatedAt?: string
    tsetmcOk?: boolean
    stocksLive?: boolean
    navLive?: boolean
    productionLive?: boolean
    financialsLive?: boolean
    imeOk?: boolean
    custeelOk?: boolean
    infra?: Record<string, string>
    overviewApiAt?: string
  }
}

async function fetchTgjuAjax(): Promise<Record<string, { p: string; d: string; dp: string; dt: string; h?: string; l?: string; t?: string }>> {
  try {
    const res = await fetchWithTimeout(TGJU_AJAX, 5000, { headers: { Accept: 'application/json' } })
    if (!res.ok) return {}
    const json = (await res.json()) as { current?: Record<string, { p: string; d: string; dp: string; dt: string; h?: string; l?: string; t?: string }> }
    return json.current || {}
  } catch {
    return {}
  }
}

async function fetchTgjuHistory(key: string, limit = 90): Promise<HistoryPoint[]> {
  try {
    const res = await fetchWithTimeout(`${TGJU_HIST}/${key}`, 6000, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: string[][] }
    const rows = json.data || []
    return rows
      .slice(0, limit)
      .map((row) => ({
        date: row[6],
        dateJalali: row[7],
        value: parseFaNumber(row[3]),
      }))
      .filter((p) => Number.isFinite(p.value))
      .reverse()
  } catch {
    return []
  }
}

/** Full OHLC from TGJU, filtered from `fromGreg` (YYYY/MM/DD). Newest-first API → reverse. */
async function fetchTgjuOhlc(key: string, fromGreg = '2022/01/01'): Promise<CandlePoint[]> {
  try {
    const res = await fetchWithTimeout(`${TGJU_HIST}/${key}`, 6000, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: string[][] }
    const out: CandlePoint[] = []
    for (const row of json.data || []) {
      if (!Array.isArray(row) || row.length < 8) continue
      const date = String(row[6] || '').replace(/-/g, '/').slice(0, 10)
      if (!date || date < fromGreg) break // newest-first
      const open = parseFaNumber(row[0])
      const low = parseFaNumber(row[1])
      const high = parseFaNumber(row[2])
      const close = parseFaNumber(row[3])
      if (![open, low, high, close].every(Number.isFinite)) continue
      out.push({ date, dateJalali: String(row[7] || ''), open, high, low, close })
    }
    out.reverse()
    return out
  } catch {
    return []
  }
}

/**
 * شاخص کل را از Pages Function بخوان تا CORS/timeout مرورگر باعث ناقص شدن
 * تاریخچه نشود. Function نتیجهٔ معتبر را کش می‌کند؛ TGJU مستقیم فقط پشتیبان است.
 */
async function fetchBourseOhlc(): Promise<CandlePoint[]> {
  try {
    const res = await fetchWithTimeout('/api/index-history', 7000, { cache: 'no-store' })
    if (res.ok) {
      const json = (await res.json()) as { candles?: CandlePoint[] }
      if (Array.isArray(json.candles) && json.candles.length) return json.candles
    }
  } catch {
    // TGJU مستقیم در پایین نقش پشتیبان دارد.
  }
  return fetchTgjuOhlc('bourse', '2022/01/01')
}

function tehranGregorianDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || ''
  return `${get('year')}/${get('month')}/${get('day')}`
}

/**
 * TGJU's long history can lag its live quote. Add/update today's close so the
 * historical chart always reaches the current session; the archived OHLC rows
 * remain untouched and TGJU history is still the long-range source.
 */
function withCurrentTedpixCandle(
  rows: CandlePoint[],
  overview: DashboardData['overview'],
  quote?: { h?: string; l?: string },
): CandlePoint[] {
  const close = Number(overview.tedpix.value)
  if (!Number.isFinite(close) || close <= 0 || overview.dataSource !== 'live') return rows

  const day = tehranGregorianDate()
  const previous = rows[rows.length - 1]
  const previousClose = Number(previous?.close)
  const high = parseFaNumber(quote?.h)
  const low = parseFaNumber(quote?.l)
  const current: CandlePoint = {
    date: day,
    dateJalali: overview.dateJalali,
    open: Number.isFinite(previousClose) ? previousClose : close,
    high: Number.isFinite(high) && high > 0 ? high : Math.max(close, previousClose || close),
    low: Number.isFinite(low) && low > 0 ? low : Math.min(close, previousClose || close),
    close,
  }
  const byDate = new Map(rows.map((row) => [row.date.replace(/-/g, '/').slice(0, 10), row]))
  byDate.set(day, { ...byDate.get(day), ...current })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

async function fetchFred(id: string, label: string): Promise<FredBundle | null> {
  const endpoints = [
    `/api/fred?id=${encodeURIComponent(id)}&limit=120`,
    `/data/fred/${encodeURIComponent(id)}.json`,
  ]
  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithTimeout(endpoint, 5000)
      if (!res.ok) continue
      const json = (await res.json()) as {
        ok?: boolean
        last?: number
        changePct?: number
        history?: { date: string; value: number }[]
      }
      if (json.ok === false) continue
      if (json.last == null && !(json.history && json.history.length)) continue
      return {
        id,
        label,
        last: json.last ?? null,
        changePct: json.changePct ?? 0,
        history: (json.history || []).map((h) => ({ date: h.date, value: h.value })),
      }
    } catch {
      // try next endpoint
    }
  }
  return null
}

function applyLiveQuotes(base: DashboardData, current: Awaited<ReturnType<typeof fetchTgjuAjax>>) {
  let liveCount = 0

  const patchCommodity = (id: string, key: string) => {
    const row = current[key]
    if (!row) return
    const value = parseFaNumber(row.p)
    if (!Number.isFinite(value)) return
    const changePct = parseFaNumber(row.dp)
    const changeAbs = parseFaNumber(row.d)
    const signed =
      row.dt === 'low' || changePct < 0 ? -Math.abs(changeAbs) : Math.abs(changeAbs)
    const idx = base.commodities.findIndex((c) => c.id === id)
    const next: CommodityQuote = {
      id,
      name: base.commodities[idx]?.name || id,
      value,
      unit: base.commodities[idx]?.unit || '',
      change: signed,
      changePct: row.dt === 'low' ? -Math.abs(changePct) : Math.abs(changePct),
      source: 'tgju',
    }
    if (idx >= 0) base.commodities[idx] = { ...base.commodities[idx], ...next }
    else base.commodities.push(next)
    liveCount += 1
  }

  for (const { key, id } of LIVE_QUOTE_KEYS) {
    if (id === 'bourse') continue
    patchCommodity(id, key)
  }

  // Ensure iron ore / steel coil exist as commodities for Custeel interim
  if (current['base-us-iron-ore'] && !base.commodities.find((c) => c.id === 'base-us-iron-ore')) {
    patchCommodity('base-us-iron-ore', 'base-us-iron-ore')
    const c = base.commodities.find((x) => x.id === 'base-us-iron-ore')
    if (c) {
      c.name = 'سنگ‌آهن (جایگزین Custeel)'
      c.unit = 'دلار/تن'
    }
  }
  if (current['base-us-steel-coil'] && !base.commodities.find((c) => c.id === 'base-us-steel-coil')) {
    patchCommodity('base-us-steel-coil', 'base-us-steel-coil')
    const c = base.commodities.find((x) => x.id === 'base-us-steel-coil')
    if (c) {
      c.name = 'ورق گرم آمریکا'
      c.unit = 'دلار/تن'
    }
  }

  const bourse = current.bourse
  if (bourse) {
    const value = parseFaNumber(bourse.p)
    const change = parseFaNumber(bourse.d)
    const changePct = parseFaNumber(bourse.dp)
    if (Number.isFinite(value)) {
      base.overview.tedpix.value = value
      base.overview.tedpix.change = bourse.dt === 'low' ? -Math.abs(change) : Math.abs(change)
      base.overview.tedpix.changePct = bourse.dt === 'low' ? -Math.abs(changePct) : Math.abs(changePct)
      liveCount += 1
    }
  }

  const dollar = base.commodities.find((c) => c.id === 'price_dollar_rl')
  if (dollar?.source === 'tgju') {
    base.overview.usdRate = dollar.value
  }

  // Update steel iron ore quote from live if present
  const iron = base.commodities.find((c) => c.id === 'base-us-iron-ore')
  if (iron?.source === 'tgju') {
    const s = base.steel.find((x) => x.id === 'seaborne62')
    if (s) {
      s.value = iron.value
      s.changePct = iron.changePct
      s.change = iron.change
    }
  }

  return liveCount
}

function markSources(base: DashboardData, liveCount: number, fredOk: number, now: string) {
  const sources: SourceStatus[] = base.sources.map((s) => {
    if (s.id === 'tgju') {
      return {
        ...s,
        status: liveCount > 0 ? 'live' : 'error',
        note: liveCount > 0 ? `${liveCount} شاخص زنده (بورس + کامودیتی)` : 'خطا در TGJU',
        lastOk: liveCount > 0 ? now : s.lastOk,
      }
    }
    if (s.id === 'tradingeconomics') {
      return {
        ...s,
        status: fredOk > 0 ? 'live' : 'seed',
        note: fredOk > 0 ? `FRED · ${fredOk} سری` : 'FRED از /api/fred — نیاز به دیپلوی Pages',
        lastOk: fredOk > 0 ? now : s.lastOk,
      }
    }
    if (s.id === 'custeel') {
      return {
        ...s,
        status: liveCount > 0 ? 'live' : 'seed',
        note: 'لاگین اشتراک — قیمت زنجیره چین (اسکرپر /api/steel)',
        lastOk: liveCount > 0 ? now : s.lastOk,
      }
    }
    return s
  })
  return sources
}

async function fetchScrapedMarket(): Promise<{
  histories: Record<string, HistoryPoint[]>
  candleHistories?: Record<string, CandlePoint[]>
  mineralStocks?: MineralStockSnap[]
  sectors: LiveBundle['sectors']
  meta: LiveBundle['scrapeMeta']
  overviewLive?: {
    ok?: boolean
    totalMarketValueHmt?: number
    totalMarketValueUsdM?: number
    usdRate?: number
    totalTradeValueHmt?: number
    totalTradeValueSource?: string
    marketValueSource?: string
    retailMoneyFlowDailyBillionToman?: number
    retailTradeValueBillionToman?: number
    retailTradeValueHmt?: number
    retailMoneyFlowYtd?: number
    retailMoneyFlowYtdSource?: string
    moneyFlowSeries?: { date: string; dateJalali?: string; value: number }[]
    moneyFlowAsOfJalali?: string
    impacts?: DashboardData['impacts'] | null
    impactsFromTsetmc?: boolean
    impactsFromSourceArena?: boolean
    impactsFromRahavard?: boolean
    impactsSource?: string
    dateJalali?: string
    marketPulse?: DashboardData['overview']['marketPulse']
    marketPulseHistory?: DashboardData['overview']['marketPulseHistory']
    topTrades?: DashboardData['topTrades']
    topTradesSource?: string
    indices?: {
      tedpix?: { name?: string; value?: number; change?: number; changePct?: number; source?: string }
      equalWeight?: { name?: string; value?: number; change?: number; changePct?: number; source?: string }
      ifb?: { name?: string; value?: number; change?: number; changePct?: number; source?: string }
    }
    notes?: string[]
    blocked?: string[]
    asOf?: string
  }
  marketPulse?: {
    current?: DashboardData['overview']['marketPulse']
    history?: DashboardData['overview']['marketPulseHistory']
  }
  candles1401?: import('./types').CandlePoint[]
} | null> {
  try {
    const res = await fetchWithTimeout('/data/market.json', 5000, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as {
      updatedAt?: string
      histories?: Record<string, HistoryPoint[]>
      candleHistories?: Record<string, CandlePoint[]>
      mineralStocks?: MineralStockSnap[]
      sectors?: LiveBundle['sectors']
      tsetmc?: { ok?: boolean }
      ime?: { ok?: boolean }
      infra?: Record<string, string>
      moneyFlowYtd?: {
        ytdBillionToman?: number
        asOfJalali?: string
        series?: { date: string; dateJalali?: string; value: number }[]
      }
      overviewLive?: {
        ok?: boolean
        totalMarketValueHmt?: number
        totalMarketValueUsdM?: number
        usdRate?: number
        totalTradeValueHmt?: number
        totalTradeValueSource?: string
        marketValueSource?: string
        retailMoneyFlowDailyBillionToman?: number
        retailTradeValueBillionToman?: number
        retailTradeValueHmt?: number
        retailMoneyFlowYtd?: number
        retailMoneyFlowYtdSource?: string
        moneyFlowSeries?: { date: string; dateJalali?: string; value: number }[]
        moneyFlowAsOfJalali?: string
        impacts?: DashboardData['impacts'] | null
        impactsFromTsetmc?: boolean
        impactsFromSourceArena?: boolean
        topTrades?: DashboardData['topTrades']
        topTradesSource?: string
        indices?: {
          tedpix?: { name?: string; value?: number; change?: number; changePct?: number; source?: string }
          equalWeight?: { name?: string; value?: number; change?: number; changePct?: number; source?: string }
          ifb?: { name?: string; value?: number; change?: number; changePct?: number; source?: string }
        }
        notes?: string[]
        blocked?: string[]
        asOf?: string
      }
      candles1401?: import('./types').CandlePoint[]
      marketPulse?: {
        current?: DashboardData['overview']['marketPulse']
        history?: DashboardData['overview']['marketPulseHistory']
      }
    }
    const overviewLive = json.overviewLive
      ? {
          ...json.overviewLive,
          retailMoneyFlowYtd:
            json.overviewLive.retailMoneyFlowYtd ?? json.moneyFlowYtd?.ytdBillionToman,
          moneyFlowSeries: json.overviewLive.moneyFlowSeries?.length
            ? json.overviewLive.moneyFlowSeries
            : json.moneyFlowYtd?.series,
          moneyFlowAsOfJalali:
            json.overviewLive.moneyFlowAsOfJalali ?? json.moneyFlowYtd?.asOfJalali,
        }
      : json.overviewLive
    return {
      histories: json.histories || {},
      candleHistories: json.candleHistories,
      mineralStocks: json.mineralStocks,
      sectors: json.sectors || [],
      meta: {
        updatedAt: json.updatedAt,
        tsetmcOk: Boolean(json.tsetmc?.ok),
        imeOk: Boolean(json.ime?.ok),
        infra: json.infra,
      },
      overviewLive,
      marketPulse: json.marketPulse,
      candles1401: json.candles1401,
    }
  } catch {
    return null
  }
}

async function fetchTgjuIntraday(): Promise<IntradayPoint[]> {
  try {
    const res = await fetchWithTimeout(
      'https://api.tgju.org/v1/market/indicator/today-table-data/bourse?lang=fa',
      5000,
      { headers: { Accept: 'application/json' } },
    )
    if (!res.ok) return []
    const json = (await res.json()) as { data?: string[][] }
    const rows = json.data || []
    const points = rows
      .map((row) => ({
        time: String(row[1] || '').trim(),
        value: parseFaNumber(row[0]),
        change: parseFaNumber(String(row[2] || '').replace(/<[^>]+>/g, '')),
      }))
      .filter((p) => p.time && Number.isFinite(p.value))
    return points.reverse()
  } catch {
    return []
  }
}

type OverviewApi = {
  ok?: boolean
  updatedAt?: string
  dateJalali?: string
  dateGregorian?: string
  indices?: {
    tedpix?: { name?: string; value?: number; change?: number; changePct?: number; source?: string }
    equalWeight?: { name?: string; value?: number; change?: number; changePct?: number; source?: string }
    ifb?: { name?: string; value?: number; change?: number; changePct?: number; source?: string }
  }
  usdRate?: number
  bourseMarketValueHmt?: number
  ifbMarketValueHmt?: number
  totalMarketValueHmt?: number
  totalMarketValueUsdM?: number
  marketValueSource?: string
  totalTradeValueHmt?: number
  totalTradeValueSource?: string
  impacts?: DashboardData['impacts'] | null
  impactsFromSourceArena?: boolean
  impactsFromRahavard?: boolean
  impactsSource?: string
  topTrades?: DashboardData['topTrades']
  topTradesSource?: string
  marketPulse?: DashboardData['overview']['marketPulse']
  marketPulseHistory?: DashboardData['overview']['marketPulseHistory']
  retailMoneyFlowYtd?: number
  retailMoneyFlowYtdSource?: string
  moneyFlowAsOfJalali?: string
  moneyFlowSeries?: { date: string; dateJalali?: string; value: number }[]
  intraday?: { points?: IntradayPoint[]; note?: string; source?: string }
  parsistahlil?: {
    ok?: boolean
    retailTradeValueBillionToman?: number
    retailMoneyFlowDailyBillionToman?: number
    dateJalali?: string
    error?: string
  }
  blocked?: string[]
  errors?: string[]
}

async function fetchOverviewApi(): Promise<OverviewApi | null> {
  try {
    const res = await fetchWithTimeout('/api/overview', 12_000, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as OverviewApi
  } catch {
    return null
  }
}

const PULSE_SESSION_KEY = 'midco-pulse-history-v7'
export const PULSE_REFRESH_MS = 30 * 1000
/** Cash session chart starts at 09:00 Tehran (user-facing axis). */
export const PULSE_HIST_START = '09:00'
/** Cash equities / bond / equity-ETF board close. */
export const PULSE_CASH_END = '12:30'
/** Gold commodity ETFs keep trading into the afternoon (~17:00). */
export const PULSE_HIST_END = '17:00'

export function clampPulseHistoryTime(hhmm: string | undefined | null): string | null {
  const t = String(hhmm || '')
  if (!/^\d{2}:\d{2}$/.test(t)) return null
  if (t < PULSE_HIST_START) return null
  if (t > PULSE_HIST_END) return PULSE_HIST_END
  return t
}

/** Current Tehran wall-clock HH:MM (no seconds). */
export function tehranNowHhmm(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hh = parts.find((p) => p.type === 'hour')?.value || '00'
  const mm = parts.find((p) => p.type === 'minute')?.value || '00'
  return `${hh}:${mm}`
}

/** Axis end for live pulse charts: now, never past 17:00, never before 09:00. */
export function pulseChartEndLabel(now = new Date()): string {
  const t = tehranNowHhmm(now)
  if (t < PULSE_HIST_START) return PULSE_HIST_START
  if (t > PULSE_HIST_END) return PULSE_HIST_END
  return t
}

/** Cash-board breadth chart (مثبت/منفی): 09:00 → now, capped at 13:00. */
export const PULSE_BREADTH_END = '13:00'

export function pulseBreadthChartEndLabel(now = new Date()): string {
  const t = tehranNowHhmm(now)
  if (t < PULSE_HIST_START) return PULSE_HIST_START
  if (t > PULSE_BREADTH_END) return PULSE_BREADTH_END
  return t
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minutesToHhmm(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

type PulseApi = {
  ok?: boolean
  marketPulse?: DashboardData['overview']['marketPulse']
  marketPulseHistory?: DashboardData['overview']['marketPulseHistory']
  dateJalali?: string
  availableDays?: string[]
}

function pulseStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* private mode */
  }
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage
  } catch {
    /* ignore */
  }
  return null
}

function readSessionPulse(): {
  dateJalali?: string
  history: NonNullable<DashboardData['overview']['marketPulseHistory']>
} {
  try {
    const store = pulseStorage()
    if (!store) return { history: [] }
    const raw = store.getItem(PULSE_SESSION_KEY) || sessionStorage.getItem('midco-pulse-history-v4')
    if (!raw) return { history: [] }
    const parsed = JSON.parse(raw) as { dateJalali?: string; history?: DashboardData['overview']['marketPulseHistory'] }
    return { dateJalali: parsed.dateJalali, history: Array.isArray(parsed.history) ? parsed.history : [] }
  } catch {
    return { history: [] }
  }
}

function writeSessionPulse(
  dateJalali: string | undefined,
  history: NonNullable<DashboardData['overview']['marketPulseHistory']>,
) {
  try {
    const store = pulseStorage()
    store?.setItem(PULSE_SESSION_KEY, JSON.stringify({ dateJalali, history }))
  } catch {
    /* quota / private mode */
  }
}

function mergePulsePoints(
  ...lists: Array<DashboardData['overview']['marketPulseHistory'] | undefined>
): NonNullable<DashboardData['overview']['marketPulseHistory']> {
  const byTime = new Map<string, NonNullable<DashboardData['overview']['marketPulseHistory']>[number]>()
  for (const list of lists) {
    for (const p of list || []) {
      if (!p?.time) continue
      const t = clampPulseHistoryTime(String(p.time))
      if (!t) continue
      byTime.set(t, { ...byTime.get(t), ...p, time: t })
    }
  }
  return [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time))).slice(-720)
}

/** Build a continuous HH:MM series from 09:00 → end (usually «now»), forward-filling known samples. */
export function densifyFlowSeries(
  points: Record<string, string | number | null | undefined>[],
  keys: string[],
  endLabel?: string,
): Record<string, string | number>[] {
  const end = clampPulseHistoryTime(endLabel) || pulseChartEndLabel()
  const start = PULSE_HIST_START
  const byLabel = new Map<string, Record<string, string | number | null | undefined>>()
  for (const p of points || []) {
    const label = clampPulseHistoryTime(String(p.label || ''))
    if (!label || label > end) continue
    byLabel.set(label, { ...byLabel.get(label), ...p, label })
  }

  const startMin = hhmmToMinutes(start)
  const endMin = hhmmToMinutes(end)
  if (endMin < startMin) return []

  const last: Record<string, number> = {}
  const out: Record<string, string | number>[] = []
  for (let mins = startMin; mins <= endMin; mins += 1) {
    const label = minutesToHhmm(mins)
    const sample = byLabel.get(label)
    const next: Record<string, string | number> = { label }
    for (const k of keys) {
      const raw = sample?.[k]
      if (raw != null && raw !== '' && Number.isFinite(Number(raw))) last[k] = Number(raw)
      next[k] = last[k] ?? 0
    }
    out.push(next)
  }
  return out
}

export async function fetchPulseApi(): Promise<{
  marketPulse?: DashboardData['overview']['marketPulse']
  marketPulseHistory: NonNullable<DashboardData['overview']['marketPulseHistory']>
} | null> {
  try {
    const res = await fetchWithTimeout('/api/pulse', 4000, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as PulseApi
    const session = readSessionPulse()
    const dateJalali = json.dateJalali || json.marketPulse?.dateJalali || session.dateJalali
    if (session.dateJalali && dateJalali && session.dateJalali !== dateJalali) {
      session.history = []
    }
    const history = mergePulsePoints(session.history, json.marketPulseHistory)
    writeSessionPulse(dateJalali, history)
    return { marketPulse: json.marketPulse, marketPulseHistory: history }
  } catch {
    return null
  }
}

/** Merge a pulse tick into existing dashboard overview (client-side densify). */
export function applyPulseToDashboard(
  data: DashboardData,
  pulse: {
    marketPulse?: DashboardData['overview']['marketPulse']
    marketPulseHistory?: DashboardData['overview']['marketPulseHistory']
  } | null,
): DashboardData {
  if (!pulse) return data
  const next = { ...data, overview: { ...data.overview } }
  if (pulse.marketPulse) next.overview.marketPulse = pulse.marketPulse
  const session = readSessionPulse()
  const dateJalali = pulse.marketPulse?.dateJalali || session.dateJalali
  const history = mergePulsePoints(session.history, next.overview.marketPulseHistory, pulse.marketPulseHistory)
  writeSessionPulse(dateJalali, history)
  next.overview.marketPulseHistory = history
  return next
}

function patchIndex(
  target: { name: string; value: number; change: number; changePct: number },
  live?: { name?: string; value?: number; change?: number; changePct?: number },
) {
  if (!live || live.value == null || !Number.isFinite(live.value)) return false
  if (live.name) target.name = live.name
  target.value = live.value
  if (live.change != null && Number.isFinite(live.change)) target.change = live.change
  if (live.changePct != null && Number.isFinite(live.changePct)) target.changePct = live.changePct
  return true
}

type ImpactRow = { symbol: string; impact: number }

/** Normalize SourceArena / legacy shapes into UI `{ boursePos, bourseNeg, ifbPos, ifbNeg }`. */
function normalizeImpacts(raw: unknown): DashboardData['impacts'] | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const toRows = (v: unknown): ImpactRow[] => {
    if (!Array.isArray(v)) return []
    return v
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        const r = row as Record<string, unknown>
        const symbol = String(r.symbol ?? r.name ?? '').trim()
        const impact = Number(r.impact ?? r.effect)
        if (!symbol || !Number.isFinite(impact)) return null
        return { symbol, impact }
      })
      .filter((x): x is ImpactRow => Boolean(x))
  }

  // Legacy mistaken shape from earlier SourceArena wiring
  if ('positive' in obj || 'negative' in obj) {
    const pos = toRows(obj.positive)
    const neg = toRows(obj.negative)
    if (!pos.length && !neg.length) return null
    return { boursePos: pos, bourseNeg: neg, ifbPos: [], ifbNeg: [] }
  }

  const out = {
    boursePos: toRows(obj.boursePos),
    bourseNeg: toRows(obj.bourseNeg),
    ifbPos: toRows(obj.ifbPos),
    ifbNeg: toRows(obj.ifbNeg),
  }
  if (!out.boursePos.length && !out.bourseNeg.length && !out.ifbPos.length && !out.ifbNeg.length) {
    return null
  }
  return out
}

function applyFreshOverview(base: DashboardData, api: OverviewApi | null, intradayFallback: IntradayPoint[]) {
  const o = base.overview
  const sources = { ...(o.fieldSources || {}) }
  const notes = [...(o.liveNotes || [])]

  if (api?.indices) {
    if (patchIndex(o.tedpix, api.indices.tedpix)) sources.tedpix = api.indices.tedpix?.source || 'live'
    if (patchIndex(o.equalWeight, api.indices.equalWeight)) sources.equalWeight = 'shakhesban-live'
    if (patchIndex(o.ifb, api.indices.ifb)) sources.ifb = 'shakhesban-live'
  }

  if (api?.totalMarketValueHmt != null && Number.isFinite(api.totalMarketValueHmt)) {
    o.totalMarketValueHmt = api.totalMarketValueHmt
    sources.marketValue = api.marketValueSource || 'sourcearena-bourse+ifb'
    notes.unshift(
      `ارزش بازار: بورس ${api.bourseMarketValueHmt ?? '—'} + فرابورس ${api.ifbMarketValueHmt ?? '—'} = ${api.totalMarketValueHmt} همت (SourceArena)`,
    )
  }
  if (api?.totalMarketValueUsdM != null && Number.isFinite(api.totalMarketValueUsdM)) {
    o.totalMarketValueUsdM = api.totalMarketValueUsdM
    sources.usdMarketValue = 'marketValue÷tgjuUsd'
  }
  if (api?.totalTradeValueHmt != null && Number.isFinite(api.totalTradeValueHmt)) {
    o.totalTradeValueHmt = api.totalTradeValueHmt
    sources.totalTrade = api.totalTradeValueSource || 'sourcearena'
  }

  if (api?.usdRate != null && Number.isFinite(api.usdRate)) {
    o.usdRate = api.usdRate
    sources.usdRate = 'tgju'
    if (o.totalMarketValueHmt > 0 && (api.totalMarketValueUsdM == null || !Number.isFinite(api.totalMarketValueUsdM))) {
      o.totalMarketValueUsdM = Math.round((o.totalMarketValueHmt * 1e13) / api.usdRate / 1e6)
      sources.usdMarketValue = 'marketValue÷tgjuUsd'
    }
  }

  if (api?.impactsFromSourceArena && api.impacts) {
    // applied on base via caller — store flag on overview
    o.impactsLive = true
    sources.impacts = api.impactsSource || 'sourcearena'
  }
  if (api?.impactsFromRahavard && api.impacts) {
    o.impactsLive = true
    sources.impacts = api.impactsSource || 'rahavard365'
  }
  if (api?.dateJalali) {
    o.dateJalali = api.dateJalali
    sources.dateJalali = 'tehran-live'
  }
  if (api?.dateGregorian) {
    o.dateGregorian = api.dateGregorian
  }
  if (api?.marketPulse) {
    o.marketPulse = api.marketPulse
    sources.marketPulse = api.marketPulse.source || 'tradersarena'
    const equityRetailFlow = api.marketPulse.equityRetailMoneyFlowBillionToman
    if (equityRetailFlow != null && Number.isFinite(equityRetailFlow)) {
      o.retailMoneyFlowDaily = equityRetailFlow
      sources.retailMoneyFlowDaily = 'tradersarena-equity'
    }
  }
  if (api?.marketPulseHistory?.length) {
    o.marketPulseHistory = api.marketPulseHistory
  }
  if (api?.topTrades?.length) {
    // applied on base via caller
    sources.topTrades = api.topTradesSource || 'sourcearena-all'
  }

  const pars = api?.parsistahlil
  if (pars?.ok) {
    if (pars.retailTradeValueBillionToman != null) {
      o.retailTradeValueBillionToman = pars.retailTradeValueBillionToman
      o.retailTradeValueHmt = pars.retailTradeValueBillionToman / 1000
      sources.retailTrade = 'parsistahlil-live'
    }
    notes.unshift(
      `پارسیس زنده: معاملات خرد=${pars.retailTradeValueBillionToman ?? '—'} میلیارد تومان` +
        (pars.dateJalali ? ` (${pars.dateJalali})` : ''),
    )
  } else if (api) {
    notes.unshift(`پارسیس در API زنده خوانده نشد${pars?.error ? `: ${pars.error}` : ''}`)
  }

  if (api?.retailMoneyFlowYtd != null && Number.isFinite(api.retailMoneyFlowYtd)) {
    o.retailMoneyFlowYtd = api.retailMoneyFlowYtd
    sources.retailMoneyFlowYtd = api.retailMoneyFlowYtdSource || 'parsistahlil-cumulative'
    notes.unshift(
      `YTD پول حقیقی از ابتدای ۱۴۰۴: ${api.retailMoneyFlowYtd}` +
        (api.moneyFlowAsOfJalali ? ` (تا ${api.moneyFlowAsOfJalali})` : ''),
    )
  }
  if (api?.moneyFlowSeries?.length) {
    o.moneyFlowSeries = api.moneyFlowSeries.map((r) => ({
      date: r.date,
      value: r.value,
    }))
  }

  const intraday = api?.intraday?.points?.length ? api.intraday.points : intradayFallback
  if (intraday.length) {
    o.intradayIndex = intraday.map((p) => ({ time: p.time.slice(0, 5), value: p.value }))
    sources.intraday = api?.intraday?.source || 'tgju-today-table'
    notes.unshift(api?.intraday?.note || 'نمودار درون‌روزی از today-table TGJU (رزولوشن چنددقیقه‌ای).')
  }

  if (api?.blocked?.length) o.blockedSources = api.blocked
  o.fieldSources = sources
  o.liveNotes = notes.slice(0, 12)
  o.dataSource = 'live'
  return Boolean(api?.ok) || intraday.length > 0
}

function applyOverviewLive(
  base: DashboardData,
  live: NonNullable<Awaited<ReturnType<typeof fetchScrapedMarket>>>['overviewLive'],
  candles?: import('./types').CandlePoint[],
) {
  if (!live?.ok) {
    if (candles?.length) base.overview.candles1401 = candles
    return false
  }
  const o = base.overview
  const sources: Record<string, string> = {}

  if (live.indices) {
    if (patchIndex(o.tedpix, live.indices.tedpix)) sources.tedpix = live.indices.tedpix?.source || 'shakhesban'
    if (patchIndex(o.equalWeight, live.indices.equalWeight)) sources.equalWeight = 'shakhesban'
    if (patchIndex(o.ifb, live.indices.ifb)) sources.ifb = 'shakhesban'
  }

  if (live.totalMarketValueHmt != null) {
    o.totalMarketValueHmt = live.totalMarketValueHmt
    sources.marketValue = live.marketValueSource || 'interim'
  }
  if (live.totalMarketValueUsdM != null) {
    o.totalMarketValueUsdM = live.totalMarketValueUsdM
    sources.usdMarketValue = 'marketValue÷tgjuUsd'
  }
  if (live.usdRate != null) {
    o.usdRate = live.usdRate
    sources.usdRate = 'tgju'
  }
  if (live.totalTradeValueHmt != null) {
    o.totalTradeValueHmt = live.totalTradeValueHmt
    sources.totalTrade = live.totalTradeValueSource || 'interim'
  }
  if (live.retailTradeValueBillionToman != null) {
    o.retailTradeValueBillionToman = live.retailTradeValueBillionToman
    o.retailTradeValueHmt = live.retailTradeValueHmt ?? live.retailTradeValueBillionToman / 1000
    sources.retailTrade = 'parsistahlil'
  }
  if (live.retailMoneyFlowYtd != null) {
    o.retailMoneyFlowYtd = live.retailMoneyFlowYtd
    sources.retailMoneyFlowYtd = live.retailMoneyFlowYtdSource || 'parsistahlil-cumulative'
  }
  if (live.moneyFlowSeries?.length) {
    o.moneyFlowSeries = live.moneyFlowSeries.map((r) => ({
      date: r.date,
      value: Number(r.value),
    }))
  }

  const liveAny = live as {
    impactsFromSourceArena?: boolean
    impactsFromRahavard?: boolean
    impactsFromTsetmc?: boolean
    impactsSource?: string
    impacts?: unknown
    dateJalali?: string
    marketPulse?: DashboardData['overview']['marketPulse']
    marketPulseHistory?: DashboardData['overview']['marketPulseHistory']
  }
  const normalized = normalizeImpacts(liveAny.impacts)
  if (
    normalized &&
    (liveAny.impactsFromSourceArena || liveAny.impactsFromRahavard || liveAny.impactsFromTsetmc || liveAny.impactsSource)
  ) {
    base.impacts = normalized
    o.impactsLive = true
    sources.impacts =
      liveAny.impactsSource ||
      (liveAny.impactsFromRahavard ? 'rahavard365' : liveAny.impactsFromSourceArena ? 'sourcearena' : 'tsetmc')
  } else {
    o.impactsLive = false
    sources.impacts = 'pdf-seed'
  }
  if (liveAny.dateJalali) o.dateJalali = liveAny.dateJalali
  if (liveAny.marketPulse) {
    o.marketPulse = liveAny.marketPulse
    const equityRetailFlow = liveAny.marketPulse.equityRetailMoneyFlowBillionToman
    if (equityRetailFlow != null && Number.isFinite(equityRetailFlow)) {
      o.retailMoneyFlowDaily = equityRetailFlow
      sources.retailMoneyFlowDaily = 'tradersarena-equity'
    }
  }
  if (liveAny.marketPulseHistory?.length) o.marketPulseHistory = liveAny.marketPulseHistory

  if (live.topTrades?.length) {
    base.topTrades = live.topTrades
    sources.topTrades = live.topTradesSource || 'shakhesban'
  }

  if (candles?.length) o.candles1401 = candles
  const intradayPts = (live as { intraday?: { points?: { time: string; value: number }[] } }).intraday?.points
  if (intradayPts?.length) {
    o.intradayIndex = intradayPts.map((p) => ({ time: p.time.slice(0, 5), value: p.value }))
    sources.intraday = 'tgju-today-table'
  }
  o.liveNotes = live.notes
  o.fieldSources = sources
  o.blockedSources = live.blocked || []
  o.dataSource = 'live'
  return true
}

type SteelChainBundle = {
  ok?: boolean
  updatedAt?: string
  custeelOk?: boolean
  imeOk?: boolean
  steel?: DashboardData['steel']
  imeChain?: DashboardData['imeChain']
  inventories?: DashboardData['inventories'] | null
  bfRate?: DashboardData['bfRate'] | null
  billetStocks?: NonNullable<DashboardData['billetStocks']> | null
  histories?: Record<string, { date: string; value: number }[]>
  source?: string
}

async function fetchSteelChainApi(): Promise<SteelChainBundle | null> {
  // Static first (always fast). Live /api/steel can take 15–30s on Custeel — never block the
  // dashboard Promise.all on that; a short race is enough to pick up a warm edge cache.
  let staticBundle: SteelChainBundle | null = null
  try {
    const res = await fetchWithTimeout('/data/steel_chain.json', 5000, { cache: 'no-store' })
    if (res.ok) {
      const json = (await res.json()) as SteelChainBundle
      if (json?.ok || json?.steel?.length || json?.imeChain?.length) staticBundle = json
    }
  } catch {
    /* ignore */
  }

  try {
    const res = await fetchWithTimeout('/api/steel', 2500, { cache: 'no-store' })
    if (res.ok) {
      const json = (await res.json()) as SteelChainBundle
      if (json?.ok || json?.steel?.length || json?.imeChain?.length) {
        // Prefer live only when it actually beat the short budget (warm CF cache / fast path).
        if (json.custeelOk || !staticBundle) return json
        // If live fell back to static itself, keep whichever has the newer asOf on FOB rows.
        const liveAsOf = (json.steel || []).find((s) => s.asOf)?.asOf
        const staticAsOf = (staticBundle.steel || []).find((s) => s.asOf)?.asOf
        if (liveAsOf && (!staticAsOf || liveAsOf >= staticAsOf)) return json
      }
    }
  } catch {
    /* fall through to static */
  }
  return staticBundle
}

function applySteelChain(base: DashboardData, bundle: SteelChainBundle | null | undefined) {
  if (!bundle) return { custeelOk: false, imeOk: false }
  const byId = new Map(base.steel.map((s) => [s.id, s]))
  for (const row of bundle.steel || []) {
    if (!row?.id) continue
    const prev = byId.get(row.id)
    byId.set(row.id, {
      ...(prev || row),
      ...row,
      nameFa: row.nameFa || prev?.nameFa || row.name,
      unit: row.unit || prev?.unit || 'دلار/تن',
    })
  }
  // attach short history sparklines
  if (bundle.histories) {
    for (const [id, pts] of Object.entries(bundle.histories)) {
      const row = byId.get(id)
      if (!row || !pts?.length) continue
      row.history = pts.slice(-60).map((p) => ({ t: p.date, v: p.value }))
    }
  }
  const preferred = [
    'seaborne62',
    'portside62',
    'pb61',
    'brbf',
    'chile_conc',
    'iran_hem',
    'iran_conc',
    'br_pellet',
    'ime_ore',
    'ime_pellet',
    'tangshan_billet',
    'iran_export_billet',
    'ime_billet',
    'hr_shanghai',
    'ime_hr',
    'rebar_beijing',
    'ime_rebar',
    'ime_conc',
    'ime_dri',
  ]
  const merged: DashboardData['steel'] = []
  const seen = new Set<string>()
  for (const id of preferred) {
    const row = byId.get(id)
    if (row) {
      merged.push(row)
      seen.add(id)
    }
  }
  for (const [id, row] of byId) {
    if (!seen.has(id)) merged.push(row)
  }
  base.steel = merged

  if (bundle.imeChain?.length) base.imeChain = bundle.imeChain
  if (bundle.inventories?.value != null) base.inventories = bundle.inventories
  if (bundle.bfRate?.rate != null) base.bfRate = bundle.bfRate
  if (bundle.billetStocks?.value != null) base.billetStocks = bundle.billetStocks

  syncPeriodicFromSteel(base, bundle)

  const custeelOk = Boolean(
    bundle.custeelOk ||
      bundle.source?.includes('custeel') ||
      (bundle.steel || []).some((s) => String(s.source || '').includes('custeel')),
  )
  const imeOk = Boolean(
    bundle.imeOk ||
      (bundle.imeChain?.length && (bundle.source?.includes('ime') || (bundle.imeChain || []).some((r) => r.source?.includes('ime')))),
  )
  base.sources = base.sources.map((s) => {
    if (s.id === 'custeel') {
      return {
        ...s,
        status: custeelOk ? 'live' : s.status,
        note: custeelOk ? `زنده · ${bundle.source || 'custeel'}` : s.note,
        lastOk: custeelOk ? bundle.updatedAt || s.lastOk : s.lastOk,
      }
    }
    if (s.id === 'ime') {
      return {
        ...s,
        status: imeOk ? 'live' : bundle.imeOk === false ? 'blocked' : s.status,
        note: imeOk
          ? `آمار فیزیکی offer-stat · ${bundle.imeChain?.length || 0} قلم`
          : 'IME از این محیط در دسترس نیست — IP ایران / VPS',
        lastOk: imeOk ? bundle.updatedAt || s.lastOk : s.lastOk,
      }
    }
    return s
  })
  return { custeelOk, imeOk }
}

/** Map live Custeel / IME quotes onto the periodic-changes table. */
const PERIODIC_STEEL_MAP: { name: string; id: string; imeProduct?: string }[] = [
  { name: 'کنسانتره شیلی', id: 'chile_conc' },
  { name: 'گندله برزیل', id: 'br_pellet' },
  { name: 'بیلت تانگشان', id: 'tangshan_billet' },
  { name: 'میلگرد هبی', id: 'rebar_beijing' },
  { name: 'ورق گرم شانگهای', id: 'hr_shanghai' },
  { name: 'بیلت صادراتی ایران', id: 'iran_export_billet' },
  { name: 'کنسانتره IME', id: 'ime_conc', imeProduct: 'کنسانتره' },
  { name: 'گندله IME', id: 'ime_pellet', imeProduct: 'گندله' },
  { name: 'آهن اسفنجی IME', id: 'ime_dri', imeProduct: 'اسفنج' },
  { name: 'بیلت فخوز IME', id: 'ime_billet', imeProduct: 'بیلت' },
  { name: 'میلگرد IME', id: 'ime_rebar', imeProduct: 'میلگرد' },
  { name: 'ورق گرم IME', id: 'ime_hr', imeProduct: 'ورق گرم' },
]

function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || !(from > 0) || !Number.isFinite(to)) return null
  return Math.round((to / from - 1) * 1000) / 10
}

function valueOnOrBefore(
  pts: { date: string; value: number }[],
  isoDay: string,
): number | null {
  let best: number | null = null
  for (const p of pts) {
    if (!p?.date || p.value == null) continue
    if (p.date <= isoDay) best = p.value
  }
  return best
}

function daysAgoIso(days: number, now = new Date()): string {
  const d = new Date(now.getTime() - days * 86400000)
  return d.toISOString().slice(0, 10)
}

function syncPeriodicFromSteel(base: DashboardData, bundle: SteelChainBundle) {
  const byId = new Map((bundle.steel || []).map((s) => [s.id, s]))
  const hist = bundle.histories || {}
  for (const map of PERIODIC_STEEL_MAP) {
    const row = base.periodic.find((p) => p.name === map.name)
    if (!row) continue
    const steel = byId.get(map.id)
    let price = steel?.value
    if (price == null && map.imeProduct && bundle.imeChain?.length) {
      const ime = bundle.imeChain.find((r) => String(r.product || '').includes(map.imeProduct!))
      if (ime?.priceRialKg != null) price = ime.priceRialKg
    }
    if (price != null && Number.isFinite(price)) row.price = price

    const pts = hist[map.id] || []
    if (pts.length >= 2) {
      const last = pts[pts.length - 1]?.value
      const w = pctChange(valueOnOrBefore(pts, daysAgoIso(7)), last)
      const m = pctChange(valueOnOrBefore(pts, daysAgoIso(30)), last)
      const y = pctChange(valueOnOrBefore(pts, daysAgoIso(365)), last)
      if (w != null) row.weeklyPct = w
      if (m != null) row.monthlyPct = m
      if (y != null) row.yoyPct = y
    } else if (steel?.changePct != null && Number.isFinite(steel.changePct)) {
      // at least refresh daily-ish move into weekly slot when history is thin
      row.weeklyPct = Math.round(steel.changePct * 10) / 10
    }
  }
}

type NavApiBundle = {
  ok?: boolean
  holdings?: DashboardData['holdings']
  nav?: DashboardData['nav']
  source?: string
  ownershipNote?: string
}

async function fetchNavApi(): Promise<NavApiBundle | null> {
  const read = async (url: string, ms: number): Promise<NavApiBundle | null> => {
    const res = await fetchWithTimeout(url, ms, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as NavApiBundle
    if (!json?.ok || !json.holdings?.length || !json.nav || !String(json.source || '').startsWith('bourseview')) return null
    return json
  }
  // The preview loader paints the deploy snapshot immediately. Regular refreshes
  // must prefer the API, otherwise the table regresses to deploy-time data.
  try {
    const live = await read('/api/nav', 10_000)
    if (live) return live
  } catch {
    /* fall back to the last verified build snapshot */
  }
  return null
}

function applyNavLive(base: DashboardData, bundle: NavApiBundle | null | undefined) {
  if (!bundle?.ok || !bundle.holdings?.length || !bundle.nav) return false
  base.holdings = bundle.holdings
  base.nav = { ...base.nav, ...bundle.nav, prev: bundle.nav.prev || base.nav.prev }
  base.overview.fieldSources = {
    ...(base.overview.fieldSources || {}),
    nav: bundle.source || 'bourseview',
  }
  return true
}

async function fetchGlobalMarketsApi(): Promise<GlobalMarketsBundle | null> {
  const read = async (url: string, ms: number): Promise<GlobalMarketsBundle | null> => {
    const res = await fetchWithTimeout(url, ms, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as GlobalMarketsBundle & { ok?: boolean }
    if (!json?.stocks?.length) return null
    return {
      stocks: json.stocks,
      industries: json.industries || [],
      sectorPerformance: json.sectorPerformance || [],
      materialsIndustries: json.materialsIndustries || [],
      metalsMiningByCountry: json.metalsMiningByCountry || json.materialsByCountry || [],
      materialsByCountry: json.metalsMiningByCountry || json.materialsByCountry || [],
      countrySectors: [],
      news: [],
      updatedAt: json.updatedAt,
      source: json.source,
      note: json.note,
      served: json.served,
    }
  }

  // Static first — never block SPA on Yahoo scrape.
  let staticBundle: GlobalMarketsBundle | null = null
  try {
    staticBundle = await read('/data/global_markets.json', 4000)
  } catch {
    /* ignore */
  }

  try {
    const live = await read('/api/global', 4000)
    if (live && live.stocks.length >= (staticBundle?.stocks.length || 0)) return live
  } catch {
    /* fall through */
  }
  return staticBundle
}

function applyGlobalMarkets(base: DashboardData, bundle: GlobalMarketsBundle | null | undefined) {
  if (!bundle?.stocks?.length) return false
  base.globalMarkets = {
    stocks: bundle.stocks,
    industries: bundle.industries || [],
    sectorPerformance: bundle.sectorPerformance || [],
    materialsIndustries: bundle.materialsIndustries || [],
    metalsMiningByCountry: bundle.metalsMiningByCountry || bundle.materialsByCountry || [],
    materialsByCountry: bundle.metalsMiningByCountry || bundle.materialsByCountry || [],
    countrySectors: [],
    news: [],
    updatedAt: bundle.updatedAt,
    source: bundle.source || 'yahoo-finance',
    note: bundle.note,
    served: bundle.served,
  }
  return true
}

async function fetchProductionOpsApi(): Promise<ProductionOpsBundle | null> {
  const read = async (url: string, ms: number): Promise<ProductionOpsBundle | null> => {
    const res = await fetchWithTimeout(url, ms, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as ProductionOpsBundle & { ok?: boolean }
    if (!json?.companies?.length) return null
    return json
  }
  try {
    const live = await read('/api/production', 10_000)
    if (live) return live
  } catch {
    /* fall back to the last verified build snapshot */
  }
  return null
}

function applyProductionOps(base: DashboardData, bundle: ProductionOpsBundle | null | undefined) {
  if (!bundle?.companies?.length) return false
  base.productionOps = {
    ok: bundle.ok !== false,
    companies: bundle.companies,
    industryEnergyRates: bundle.industryEnergyRates || [],
    updatedAt: bundle.updatedAt,
    source: bundle.source || 'bourseview',
    note: bundle.note,
    served: bundle.served,
    errors: bundle.errors,
  }
  return true
}

async function fetchFinancialsApi(): Promise<FinancialsBundle | null> {
  const read = async (url: string, ms: number): Promise<FinancialsBundle | null> => {
    const res = await fetchWithTimeout(url, ms, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as FinancialsBundle
    if (!json?.companies?.length) return null
    return json
  }
  try {
    const live = await read('/api/financials', 10_000)
    if (live) return live
  } catch {
    /* fall back to the last verified build snapshot */
  }
  return null
}

function applyFinancials(base: DashboardData, bundle: FinancialsBundle | null | undefined) {
  if (!bundle?.companies?.length) return false
  base.financials = {
    ok: bundle.ok !== false,
    companies: bundle.companies,
    updatedAt: bundle.updatedAt,
    source: bundle.source || 'bourseview',
    note: bundle.note,
    served: bundle.served,
  }
  return true
}

type MineralStocksApiBundle = {
  stocks: MineralStockSnap[]
  served: 'live' | 'snapshot'
}

async function fetchMineralStocksApi(): Promise<MineralStocksApiBundle | null> {
  const read = async (url: string, ms: number) => {
    const res = await fetchWithTimeout(url, ms, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as { ok?: boolean; stocks?: MineralStockSnap[] } | MineralStockSnap[]
    if (!Array.isArray(json) && json.ok === false) return null
    const stocks = Array.isArray(json) ? json : json.stocks
    return stocks?.length ? stocks : null
  }

  // Live first. The snapshot is only a display fallback for a slow BourseView
  // response; callers can distinguish it and never overwrite prior live data.
  try {
    const live = await read('/api/stocks', 10_000)
    if (live) return { stocks: live, served: 'live' }
  } catch {
    /* use the last verified build snapshot below */
  }
  try {
    const snapshot = await read('/data/mineral_stocks.json', 2_500)
    if (snapshot) return { stocks: snapshot, served: 'snapshot' }
  } catch {
    /* no usable table */
  }
  return null
}

function weightedPct(
  members: StockRow[],
  key: 'dailyPct' | 'weekPct' | 'monthPct' | 'ytdPct' | 'year1Pct' | 'year3Pct',
): number {
  let num = 0
  let den = 0
  for (const s of members) {
    const w = Number(s.marketValueBr) || 0
    const v = Number(s[key])
    if (w > 0 && Number.isFinite(v)) {
      num += w * v
      den += w
    }
  }
  return den > 0 ? Math.round((num / den) * 100) / 100 : 0
}

/** Display sector: فولادی+مس → فلزات */
export function displaySector(group: string): string {
  if (group === 'فولادی' || group === 'مس' || group === 'فلزات') return 'فلزات'
  return group
}

function aggregateWeekFlows(members: StockRow[]): number[] | undefined {
  const series = members
    .map((s) => s.netIndividualWeekBt)
    .filter((a): a is number[] => Array.isArray(a) && a.length > 0)
  if (!series.length) return undefined
  const n = 7
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    let sum = 0
    let hit = false
    for (const w of series) {
      const v = w[w.length - n + i]
      if (v != null && Number.isFinite(v)) {
        sum += v
        hit = true
      }
    }
    out.push(hit ? Math.round(sum * 100) / 100 : 0)
  }
  return out
}

function rebuildIndustryRows(base: DashboardData) {
  const SECTOR_ORDER = ['سرمایه‌گذاری', 'سنگ‌آهن', 'فلزات', 'کابل'] as const
  const equities = base.stocks
    .filter((s) => !s.isIndustry)
    .map((s) => ({ ...s, group: displaySector(s.group) }))
  const rebuilt: typeof base.stocks = []

  for (const g of SECTOR_ORDER) {
    const members = equities
      .filter((s) => s.group === g)
      .sort((a, b) => (b.marketValueBr || 0) - (a.marketValueBr || 0))
    if (!members.length) continue
    rebuilt.push(...members)

    const mv = members.reduce((a, s) => a + (s.marketValueBr || 0), 0)
    const usd = members.reduce((a, s) => a + (s.marketValueUsdM || 0), 0)
    const vol = members.reduce((a, s) => a + (s.volume || 0), 0)
    const tv = members.reduce((a, s) => a + (s.tradeValueMr || 0), 0)
    const net = members.reduce((a, s) => a + (s.netIndividualBt || 0), 0)
    const weekFlow = aggregateWeekFlows(members)

    rebuilt.push({
      group: g,
      name: `صنعت ${g}`,
      isIndustry: true,
      marketValueBr: mv,
      marketValueUsdM: usd,
      volume: vol,
      tradeValueMr: tv,
      closePrice: 0,
      dailyPct: weightedPct(members, 'dailyPct'),
      weekPct: weightedPct(members, 'weekPct'),
      monthPct: weightedPct(members, 'monthPct'),
      ytdPct: weightedPct(members, 'ytdPct'),
      year1Pct: weightedPct(members, 'year1Pct'),
      year3Pct: weightedPct(members, 'year3Pct'),
      netIndividualBt: Math.round(net * 100) / 100,
      netIndividualWeekBt: weekFlow,
      returnsAdjusted: members.some((s) => s.returnsAdjusted),
      returnsSource: 'industry-weighted',
    })
  }

  for (const s of equities) {
    if (!SECTOR_ORDER.includes(s.group as (typeof SECTOR_ORDER)[number])) rebuilt.push(s)
  }
  base.stocks = rebuilt
}

function applyMineralStockReturns(base: DashboardData, snaps: MineralStockSnap[] | null | undefined) {
  if (!snaps?.length) {
    for (const s of base.stocks) {
      if (s.isIndustry) continue
      const sym = MINERAL_SYMBOL_BY_NAME[s.name]
      if (sym) s.symbol = sym
    }
    rebuildIndustryRows(base)
    return
  }
  const bySym = new Map(snaps.map((r) => [r.symbol, r]))

  const usd = base.overview.usdRate || seedDashboard.overview.usdRate || 1
  for (const s of base.stocks) {
    if (s.isIndustry) continue
    const sym = MINERAL_SYMBOL_BY_NAME[s.name]
    if (sym) s.symbol = sym
    const snap = sym ? bySym.get(sym) : undefined
    if (!snap) continue
    // Skip dead API stubs (expired BourseView cookie etc.) so seed/static stay visible.
    if (snap.returnsSource === 'error' && snap.closePrice == null && snap.ytdPct == null) continue

    if (snap.closePrice != null && snap.closePrice > 0) s.closePrice = snap.closePrice
    else if (snap.lastPrice != null && snap.lastPrice > 0) s.closePrice = snap.lastPrice
    if (snap.dailyPct != null && Number.isFinite(snap.dailyPct)) s.dailyPct = snap.dailyPct
    if (snap.weekPct != null && Number.isFinite(snap.weekPct)) s.weekPct = snap.weekPct
    if (snap.monthPct != null && Number.isFinite(snap.monthPct)) s.monthPct = snap.monthPct
    if (snap.ytdPct != null && Number.isFinite(snap.ytdPct)) s.ytdPct = snap.ytdPct
    if (snap.year1Pct != null && Number.isFinite(snap.year1Pct)) s.year1Pct = snap.year1Pct
    if (snap.year3Pct != null && Number.isFinite(snap.year3Pct)) s.year3Pct = snap.year3Pct
    if (snap.returnsSource) {
      s.returnsAdjusted = Boolean(snap.returnsAdjusted)
      s.returnsSource = snap.returnsSource
    }
    if (snap.halted != null) s.halted = snap.halted
    if (snap.volume != null) s.volume = snap.volume
    if (snap.tradeValueMr != null) s.tradeValueMr = snap.tradeValueMr
    if (snap.netIndividualBt != null && Number.isFinite(snap.netIndividualBt)) {
      s.netIndividualBt = snap.netIndividualBt
    }
    if (Array.isArray(snap.netIndividualWeekBt) && snap.netIndividualWeekBt.length) {
      s.netIndividualWeekBt = snap.netIndividualWeekBt
    }
    if (snap.freeFloatPct != null && Number.isFinite(snap.freeFloatPct)) s.freeFloatPct = snap.freeFloatPct
    if (snap.outstandingShares != null) s.outstandingShares = snap.outstandingShares
    if (snap.volumeToFloatPct != null && Number.isFinite(snap.volumeToFloatPct)) {
      s.volumeToFloatPct = snap.volumeToFloatPct
    }
    if (snap.marketValueBr != null && snap.marketValueBr > 0) {
      s.marketValueBr = snap.marketValueBr
      s.marketValueUsdM = Math.round((snap.marketValueBr * 1_000_000_000) / usd / 1_000_000)
    }
  }
  rebuildIndustryRows(base)
}

export async function loadDashboardBundle(): Promise<LiveBundle> {
  const base: DashboardData = structuredClone(seedDashboard)
  const now = new Date().toISOString()

  const [current, histEntries, candleEntries, fredEntries, scraped, overviewApi, intradayFallback, stocksApi, steelApi, navApi, globalApi, productionApi, financialsApi, retailMoneyFlowHistory] =
    await Promise.all([
      fetchTgjuAjax(),
      Promise.all(HIST_KEYS.map(async (k) => [k, await fetchTgjuHistory(k)] as const)),
      Promise.all(
        HIST_KEYS.map(async (k) => [k, k === 'bourse' ? await fetchBourseOhlc() : await fetchTgjuOhlc(k, '2022/01/01')] as const),
      ),
      Promise.all(FRED_SERIES.map(async (s) => [s.mapTo || s.id, await fetchFred(s.id, s.label)] as const)),
      fetchScrapedMarket(),
      fetchOverviewApi(),
      fetchTgjuIntraday(),
      fetchMineralStocksApi(),
      fetchSteelChainApi(),
      fetchNavApi(),
      fetchGlobalMarketsApi(),
      fetchProductionOpsApi(),
      fetchFinancialsApi(),
      fetchRetailMoneyFlowHistory(),
    ])

  const liveCount = applyLiveQuotes(base, current)
  // market.json is a deploy-time fallback: never use its headline values because
  // it can roll the live market view back by hours. Keep only its candle history.
  const overviewLiveOk = applyOverviewLive(base, undefined, scraped?.candles1401)
  const freshOk = applyFreshOverview(base, overviewApi, intradayFallback)
  const mineralStockRows = stocksApi?.stocks?.length ? stocksApi.stocks : null
  if (mineralStockRows) applyMineralStockReturns(base, mineralStockRows)
  else base.stocks = []
  const steelStatus = applySteelChain(base, steelApi)
  const navOk = applyNavLive(base, navApi)
  if (!navOk) {
    base.holdings = []
    base.overview.fieldSources = { ...(base.overview.fieldSources || {}), nav: 'bourseview-unavailable' }
  }
  const globalOk = applyGlobalMarkets(base, globalApi)
  const productionOk = applyProductionOps(base, productionApi)
  if (!productionOk) base.productionOps = { ok: false, companies: [], source: 'bourseview' }
  const financialsOk = applyFinancials(base, financialsApi)
  if (!financialsOk) base.financials = { ok: false, companies: [], source: 'bourseview' }
  const apiImpacts = normalizeImpacts(overviewApi?.impacts)
  if (apiImpacts && (overviewApi?.impactsFromSourceArena || overviewApi?.impactsFromRahavard || overviewApi?.impactsSource)) {
    base.impacts = apiImpacts
    base.overview.impactsLive = true
    base.overview.fieldSources = {
      ...(base.overview.fieldSources || {}),
      impacts: overviewApi?.impactsSource || (overviewApi?.impactsFromRahavard ? 'rahavard365' : 'sourcearena-live'),
    }
  }
  if (overviewApi?.topTrades?.length) {
    base.topTrades = overviewApi.topTrades
    base.overview.fieldSources = {
      ...(base.overview.fieldSources || {}),
      topTrades: overviewApi.topTradesSource || 'sourcearena-all',
    }
  }
  if (overviewApi?.dateJalali) {
    base.overview.dateJalali = overviewApi.dateJalali
  }
  if (overviewApi?.marketPulse) {
    base.overview.marketPulse = overviewApi.marketPulse
  }
  if (overviewApi?.marketPulseHistory?.length) {
    base.overview.marketPulseHistory = overviewApi.marketPulseHistory
  }
  // also from scraped market.json when API thin
  const scrapedPulse = scraped?.marketPulse
  if (!base.overview.marketPulse && scrapedPulse?.current) {
    base.overview.marketPulse = scrapedPulse.current
  }
  if (!base.overview.marketPulseHistory?.length && scrapedPulse?.history?.length) {
    base.overview.marketPulseHistory = scrapedPulse.history
  }
  applyRetailMoneyFlowHistory(base, retailMoneyFlowHistory)
  // densify with sessionStorage (client builds 09:00→now series while page is open)
  {
    const session = readSessionPulse()
    const dateJalali =
      base.overview.marketPulse?.dateJalali || overviewApi?.dateJalali || session.dateJalali
    if (session.dateJalali && dateJalali && session.dateJalali !== dateJalali) {
      session.history = []
    }
    const hist = mergePulsePoints(session.history, base.overview.marketPulseHistory)
    writeSessionPulse(dateJalali, hist)
    if (hist.length) base.overview.marketPulseHistory = hist
  }

  const histories: Record<string, HistoryPoint[]> = { ...(scraped?.histories || {}) }
  for (const [k, pts] of histEntries) {
    if (k === 'bourse' && (histories.bourse?.length || 0) > pts.length) continue
    if (pts.length) histories[k] = pts
  }
  // Merge Custeel steel histories for ChartsHub / SteelSection
  if (steelApi?.histories) {
    for (const [id, pts] of Object.entries(steelApi.histories)) {
      if (!pts?.length) continue
      histories[`steel:${id}`] = pts.map((p) => ({ date: p.date, value: p.value }))
    }
  }

  const candles: Record<string, CandlePoint[]> = { ...(scraped?.candleHistories || {}) }
  for (const [k, pts] of candleEntries) {
    if (pts.length) candles[k] = pts
    else if (!candles[k]?.length && histories[k]?.length) {
      // degrade: synthesize flat candles from close-only history
      candles[k] = histories[k].map((p) => ({
        date: p.date,
        dateJalali: p.dateJalali,
        open: p.value,
        high: p.value,
        low: p.value,
        close: p.value,
      }))
    }
  }
  candles.bourse = withCurrentTedpixCandle(candles.bourse || [], base.overview, current.bourse)
  // MarketOverview نمودار تاریخی را از overview.candles1401 می‌خواند؛
  // بدون این اتصال، دادهٔ زندهٔ TGJU نادیده گرفته و فایل ایستا نمایش داده می‌شد.
  if (candles.bourse?.length) base.overview.candles1401 = candles.bourse

  for (const c of base.commodities) {
    const histKey = c.id === 'base-us-iron-ore' ? 'base-us-iron-ore' : c.id
    const pts = histories[histKey]
    if (pts?.length) {
      c.history = pts.slice(-40).map((p) => ({ t: p.dateJalali || p.date, v: p.value }))
    }
  }

  if (histories.bourse?.length) {
    base.overview.indexHistory = histories.bourse.slice(-36).map((p) => ({
      date: p.dateJalali || p.date,
      value: p.value,
    }))
    if (!base.overview.intradayIndex?.length || base.overview.intradayIndex.length < 5) {
      base.overview.intradayIndex = histories.bourse.slice(-12).map((p, i) => ({
        time: p.dateJalali || `${i}`,
        value: p.value,
      }))
    }
  }

  const fred: Record<string, FredBundle> = {}
  let fredOk = 0
  for (const [mapTo, bundle] of fredEntries) {
    if (bundle) {
      fred[mapTo] = bundle
      fredOk += 1
    }
  }

  if (fred.fred_dxy?.last != null) {
    const row = base.periodic.find((p) => p.name === 'شاخص دلار')
    if (row) {
      row.price = fred.fred_dxy.last
      row.dailyPct = fred.fred_dxy.changePct
    }
  }
  if (fred.fred_dgs10?.last != null) {
    const row = base.periodic.find((p) => p.name === 'اوراق قرضه آمریکا')
    if (row) {
      row.price = fred.fred_dgs10.last
      row.dailyPct = fred.fred_dgs10.changePct
    }
  }

  base.sources = markSources(base, liveCount, fredOk, now)
  const hasPars = Boolean(
    base.overview.retailMoneyFlowDaily != null || base.overview.retailTradeValueBillionToman != null,
  )
  const hasArenaMv = Boolean(
    overviewApi?.totalMarketValueHmt != null ||
      (scraped?.overviewLive?.marketValueSource || '').includes('sourcearena'),
  )
  if (overviewLiveOk || freshOk) {
    base.sources = [
      ...base.sources.filter(
        (s) => s.id !== 'shakhesban' && s.id !== 'parsistahlil' && s.id !== 'tsetmc' && s.id !== 'sourcearena',
      ),
      {
        id: 'sourcearena',
        name: 'SourceArena / TradersArena',
        status: hasArenaMv ? 'live' : 'blocked',
        note: hasArenaMv
          ? `ارزش بازار بورس+فرابورس${
              overviewApi?.totalMarketValueHmt != null ? ` · ${overviewApi.totalMarketValueHmt} همت` : ''
            }`
          : 'در یک نگاه خوانده نشد',
        lastOk: hasArenaMv ? overviewApi?.updatedAt || scraped?.overviewLive?.asOf || now : undefined,
      },
      {
        id: 'shakhesban',
        name: 'شاخص‌بان',
        status: 'live',
        note: 'هم‌وزن + فرابورس (API زنده / اسکرپر)',
        lastOk: overviewApi?.updatedAt || scraped?.overviewLive?.asOf || now,
      },
      {
        id: 'parsistahlil',
        name: 'پارسیس‌تحلیل',
        status: hasPars ? 'live' : 'blocked',
        note: hasPars
          ? `معاملات خرد + پول حقیقی${overviewApi?.parsistahlil?.dateJalali ? ` · ${overviewApi.parsistahlil.dateJalali}` : ''}`
          : overviewApi?.parsistahlil?.error || 'گزارش وضعیت بازار خوانده نشد',
        lastOk: hasPars ? overviewApi?.updatedAt || now : undefined,
      },
    ]
  }
  base.sources = base.sources.map((s) => {
    if (s.id === 'ime') {
      const liveIme = steelStatus.imeOk || scraped?.meta?.imeOk
      return {
        ...s,
        status: liveIme ? 'live' : 'blocked',
        note: liveIme
          ? 'آمار فیزیکی offer-stat'
          : 'IME از این محیط در دسترس نیست — اسکرپر با IP ایران',
      }
    }
    if (s.id === 'yahoo') {
      const n = base.globalMarkets.stocks.length
      return {
        ...s,
        status: globalOk ? 'live' : 'seed',
        note: globalOk
          ? `${n} نماد · ${base.globalMarkets.sectorPerformance?.length || 0} سکتور · ${base.globalMarkets.materialsByCountry?.length || 0} مواد/کشور`
          : 'Yahoo Finance هنوز لود نشده',
        lastOk: globalOk ? base.globalMarkets.updatedAt || now : s.lastOk,
      }
    }
    return s
  })
  if (productionOk) {
    const n = base.productionOps.companies.length
    const has = base.sources.some((s) => s.id === 'bourseview-ops')
    const row: SourceStatus = {
      id: 'bourseview-ops',
      name: 'بورس‌ویو · تولید/انرژی',
      status: 'live',
      note: `${n} شرکت پرتفو · تولید ماهانه + آب/برق/گاز`,
      lastOk: base.productionOps.updatedAt || now,
    }
    base.sources = has
      ? base.sources.map((s) => (s.id === 'bourseview-ops' ? row : s))
      : [...base.sources, row]
  }
  base.updatedAt = overviewApi?.updatedAt || steelApi?.updatedAt || base.globalMarkets.updatedAt || now

  return {
    data: base,
    histories,
    candles,
    fred,
    sectors: scraped?.sectors || [],
    scrapeMeta: {
      ...(scraped?.meta || {}),
      stocksLive:
        stocksApi?.served === 'live' &&
        Boolean(
          mineralStockRows?.some(
            (row) =>
              row.returnsSource !== 'error' &&
              ((row.closePrice != null && row.closePrice > 0) ||
                (row.lastPrice != null && row.lastPrice > 0) ||
                row.dailyPct != null),
          ),
        ),
      navLive: navOk,
      productionLive: productionOk,
      financialsLive: financialsOk,
      overviewApiAt: overviewApi?.ok ? overviewApi.updatedAt || now : undefined,
      custeelOk: steelStatus.custeelOk,
      imeOk: steelStatus.imeOk || scraped?.meta?.imeOk,
    },
  }
}


/**
 * Fast first paint for the market overview. This intentionally does not touch
 * any BourseView endpoint, so authenticated requests cannot hold headline
 * indices, market value, trade value or the TradersArena pulse hostage.
 */
export async function loadOverviewPreview(): Promise<DashboardData> {
  const base: DashboardData = structuredClone(seedDashboard)
  const [current, overviewApi, intraday] = await Promise.all([
    fetchTgjuAjax(),
    fetchOverviewApi(),
    fetchTgjuIntraday(),
  ])
  applyLiveQuotes(base, current)
  applyFreshOverview(base, overviewApi, intraday)
  const impacts = normalizeImpacts(overviewApi?.impacts)
  if (impacts) base.impacts = impacts
  if (overviewApi?.topTrades?.length) base.topTrades = overviewApi.topTrades
  if (overviewApi?.marketPulseHistory?.length) {
    base.overview.marketPulseHistory = overviewApi.marketPulseHistory
  }
  base.updatedAt = overviewApi?.updatedAt || new Date().toISOString()
  return base
}


/** Fast first paint for the four BourseView-only panels from build snapshots. */
export async function loadBourseViewPreview(): Promise<DashboardData> {
  const base: DashboardData = structuredClone(seedDashboard)
  const [stocks, nav, production, financials] = await Promise.all([
    fetchMineralStocksApi(),
    fetchNavApi(),
    fetchProductionOpsApi(),
    fetchFinancialsApi(),
  ])
  if (stocks?.stocks?.length) applyMineralStockReturns(base, stocks.stocks)
  applyNavLive(base, nav)
  applyProductionOps(base, production)
  applyFinancials(base, financials)
  return base
}

export const REFRESH_MS = 60 * 1000
