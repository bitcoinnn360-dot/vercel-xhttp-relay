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
        updatedAt: json.updatedAt…9095 tokens truncated…dle | null = null
  try {
    staticBundle = await read('/data/financials.json', 4000)
  } catch {
    /* ignore */
  }
  try {
    const live = await read('/api/financials', 6000)
    if (live && live.companies.length >= (staticBundle?.companies.length || 0)) return live
  } catch {
    /* fall through */
  }
  return staticBundle
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

async function fetchMineralStocksApi(): Promise<MineralStockSnap[] | null> {
  const score = (stocks: MineralStockSnap[]) => {
    let n = 0
    let week = 0
    for (const s of stocks) {
      if (s.returnsSource === 'error') continue
      if (s.ytdPct != null || s.weekPct != null || s.closePrice != null || s.candleCount) n += 1
      if (Array.isArray(s.netIndividualWeekBt) && s.netIndividualWeekBt.length) week += 1
    }
    return n * 100 + week
  }

  const read = async (url: string, ms: number) => {
    const res = await fetchWithTimeout(url, ms, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as { ok?: boolean; stocks?: MineralStockSnap[] } | MineralStockSnap[]
    const stocks = Array.isArray(json) ? json : json.stocks
    return stocks?.length ? stocks : null
  }

  // Static first so a slow /api/stocks scrape never blocks the whole SPA.
  let staticStocks: MineralStockSnap[] | null = null
  try {
    staticStocks = await read('/data/mineral_stocks.json', 4000)
  } catch {
    /* ignore */
  }

  // Prefer live only when it clearly has richer money-flow / returns; keep timeout short.
  try {
    const live = await read('/api/stocks', 5000)
    if (live && score(live) > score(staticStocks || [])) return live
  } catch {
    /* fall through */
  }
  return staticStocks
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

  const [current, histEntries, candleEntries, fredEntries, scraped, overviewApi, intradayFallback, stocksApi, steelApi, navApi, globalApi, productionApi, financialsApi] =
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
    ])

  const liveCount = applyLiveQuotes(base, current)
  const overviewLiveOk = applyOverviewLive(base, scraped?.overviewLive, scraped?.candles1401)
  const freshOk = applyFreshOverview(base, overviewApi, intradayFallback)
  const mineralStockRows = stocksApi?.length ? stocksApi : scraped?.mineralStocks
  applyMineralStockReturns(base, mineralStockRows)
  const steelStatus = applySteelChain(base, steelApi)
  applyNavLive(base, navApi)
  const globalOk = applyGlobalMarkets(base, globalApi)
  const productionOk = applyProductionOps(base, productionApi)
  applyFinancials(base, financialsApi)
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
      stocksLive: Boolean(
        mineralStockRows?.some(
          (row) =>
            row.returnsSource !== 'error' &&
            ((row.closePrice != null && row.closePrice > 0) ||
              (row.lastPrice != null && row.lastPrice > 0) ||
              row.dailyPct != null),
        ),
      ),
      overviewApiAt: overviewApi?.updatedAt,
      custeelOk: steelStatus.custeelOk,
      imeOk: steelStatus.imeOk || scraped?.meta?.imeOk,
    },
  }
}

export const REFRESH_MS = 60 * 1000
