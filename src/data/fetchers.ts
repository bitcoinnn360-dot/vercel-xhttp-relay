import type { CommodityQuote, DashboardData, SourceStatus } from './types'
import { seedDashboard } from './seed'

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

export interface LiveBundle {
  data: DashboardData
  histories: Record<string, HistoryPoint[]>
  fred: Record<string, FredBundle>
  sectors: { name: string; color: string; count: number; avgChangePct: number; members: string[] }[]
  scrapeMeta: {
    updatedAt?: string
    tsetmcOk?: boolean
    imeOk?: boolean
    infra?: Record<string, string>
  }
}

async function fetchTgjuAjax(): Promise<Record<string, { p: string; d: string; dp: string; dt: string; h?: string; l?: string; t?: string }>> {
  try {
    const res = await fetch(TGJU_AJAX, { headers: { Accept: 'application/json' } })
    if (!res.ok) return {}
    const json = (await res.json()) as { current?: Record<string, { p: string; d: string; dp: string; dt: string; h?: string; l?: string; t?: string }> }
    return json.current || {}
  } catch {
    return {}
  }
}

async function fetchTgjuHistory(key: string, limit = 90): Promise<HistoryPoint[]> {
  try {
    const res = await fetch(`${TGJU_HIST}/${key}`, { headers: { Accept: 'application/json' } })
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

async function fetchFred(id: string, label: string): Promise<FredBundle | null> {
  const endpoints = [
    `/api/fred?id=${encodeURIComponent(id)}&limit=120`,
    `/data/fred/${encodeURIComponent(id)}.json`,
  ]
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint)
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
    if (s.id === 'tsetmc') {
      return {
        ...s,
        status: liveCount > 0 ? 'live' : 'seed',
        note: 'شاخص کل از TGJU (آینه بورس) — جزئیات نمادها از گزارش/اسکرپر',
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
        note: 'موقت: TGJU iron-ore/steel-coil + FRED PIORECRUSDM تا اشتراک Custeel',
        lastOk: liveCount > 0 ? now : s.lastOk,
      }
    }
    return s
  })
  return sources
}

async function fetchScrapedMarket(): Promise<{
  histories: Record<string, HistoryPoint[]>
  sectors: LiveBundle['sectors']
  meta: LiveBundle['scrapeMeta']
  overviewLive?: {
    ok?: boolean
    totalMarketValueHmt?: number
    totalMarketValueUsdM?: number
    usdRate?: number
    totalTradeValueHmt?: number
    retailMoneyFlowDailyBillionToman?: number
    impacts?: DashboardData['impacts']
    topTrades?: DashboardData['topTrades']
    notes?: string[]
    asOf?: string
  }
  candles1401?: import('./types').CandlePoint[]
} | null> {
  try {
    const res = await fetch('/data/market.json', { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as {
      updatedAt?: string
      histories?: Record<string, HistoryPoint[]>
      sectors?: LiveBundle['sectors']
      tsetmc?: { ok?: boolean }
      ime?: { ok?: boolean }
      infra?: Record<string, string>
      overviewLive?: {
        ok?: boolean
        totalMarketValueHmt?: number
        totalMarketValueUsdM?: number
        usdRate?: number
        totalTradeValueHmt?: number
        retailMoneyFlowDailyBillionToman?: number
        impacts?: DashboardData['impacts']
        topTrades?: DashboardData['topTrades']
        notes?: string[]
        asOf?: string
      }
      candles1401?: import('./types').CandlePoint[]
    }
    return {
      histories: json.histories || {},
      sectors: json.sectors || [],
      meta: {
        updatedAt: json.updatedAt,
        tsetmcOk: Boolean(json.tsetmc?.ok),
        imeOk: Boolean(json.ime?.ok),
        infra: json.infra,
      },
      overviewLive: json.overviewLive,
      candles1401: json.candles1401,
    }
  } catch {
    return null
  }
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
  if (live.totalMarketValueHmt != null) o.totalMarketValueHmt = live.totalMarketValueHmt
  if (live.totalMarketValueUsdM != null) o.totalMarketValueUsdM = live.totalMarketValueUsdM
  if (live.usdRate != null) o.usdRate = live.usdRate
  if (live.totalTradeValueHmt != null) o.totalTradeValueHmt = live.totalTradeValueHmt
  if (live.retailMoneyFlowDailyBillionToman != null) {
    o.retailMoneyFlowDaily = live.retailMoneyFlowDailyBillionToman
  }
  if (live.impacts) base.impacts = live.impacts
  if (live.topTrades?.length) base.topTrades = live.topTrades
  if (candles?.length) o.candles1401 = candles
  o.liveNotes = live.notes
  o.dataSource = 'live'
  return true
}

export async function loadDashboardBundle(): Promise<LiveBundle> {
  const base: DashboardData = structuredClone(seedDashboard)
  const now = new Date().toISOString()

  const [current, histEntries, fredEntries, scraped] = await Promise.all([
    fetchTgjuAjax(),
    Promise.all(HIST_KEYS.map(async (k) => [k, await fetchTgjuHistory(k)] as const)),
    Promise.all(FRED_SERIES.map(async (s) => [s.mapTo || s.id, await fetchFred(s.id, s.label)] as const)),
    fetchScrapedMarket(),
  ])

  const liveCount = applyLiveQuotes(base, current)
  const overviewLiveOk = applyOverviewLive(base, scraped?.overviewLive, scraped?.candles1401)

  const histories: Record<string, HistoryPoint[]> = { ...(scraped?.histories || {}) }
  for (const [k, pts] of histEntries) {
    // Prefer longer scraped bourse history (from 1401) over short client fetch
    if (k === 'bourse' && (histories.bourse?.length || 0) > pts.length) continue
    if (pts.length) histories[k] = pts
  }

  // Enrich commodity sparkline histories
  for (const c of base.commodities) {
    const histKey = c.id === 'base-us-iron-ore' ? 'base-us-iron-ore' : c.id
    const pts = histories[histKey]
    if (pts?.length) {
      c.history = pts.slice(-40).map((p) => ({ t: p.dateJalali || p.date, v: p.value }))
    }
  }

  // Intraday / long index chart from bourse history
  if (histories.bourse?.length) {
    base.overview.indexHistory = histories.bourse.slice(-36).map((p) => ({
      date: p.dateJalali || p.date,
      value: p.value,
    }))
    base.overview.intradayIndex = histories.bourse.slice(-12).map((p, i) => ({
      time: p.dateJalali || `${i}`,
      value: p.value,
    }))
  }

  const fred: Record<string, FredBundle> = {}
  let fredOk = 0
  for (const [mapTo, bundle] of fredEntries) {
    if (bundle) {
      fred[mapTo] = bundle
      fredOk += 1
    }
  }

  // Periodic macro refresh from FRED when available
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
  if (overviewLiveOk) {
    base.sources = [
      ...base.sources.filter((s) => s.id !== 'shakhesban'),
      {
        id: 'shakhesban',
        name: 'شاخص‌بان',
        status: 'live',
        note: 'ارزش بازار، معاملات، تاثیر و برآورد پول حقیقی',
        lastOk: scraped?.overviewLive?.asOf || now,
      },
    ]
  }
  if (scraped?.meta) {
    base.sources = base.sources.map((s) => {
      if (s.id === 'tsetmc') {
        return {
          ...s,
          status: scraped.meta.tsetmcOk ? 'live' : overviewLiveOk || liveCount > 0 ? 'live' : 'seed',
          note: scraped.meta.tsetmcOk
            ? 'اسکرپر TSETMC موفق'
            : overviewLiveOk
              ? 'جزئیات تابلو از شاخص‌بان — TSETMC نیاز به IP ایران'
              : 'جزئیات TSETMC نیاز به IP ایران — شاخص از TGJU',
        }
      }
      if (s.id === 'ime') {
        return {
          ...s,
          status: scraped.meta.imeOk ? 'live' : 'seed',
          note: scraped.meta.imeOk ? 'اسکرپر IME موفق' : 'IME از گزارش؛ اسکرپر کامل با IP ایران',
        }
      }
      return s
    })
  }
  base.updatedAt = now

  return {
    data: base,
    histories,
    fred,
    sectors: scraped?.sectors || [],
    scrapeMeta: scraped?.meta || {},
  }
}

export const REFRESH_MS = 3 * 60 * 1000
