import type { CandlePoint, CommodityQuote, DashboardData, SourceStatus } from './types'
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
  marketValueBr?: number
  volume?: number
  tradeValueMr?: number
  returnsAdjusted?: boolean
  returnsSource?: string
  candleCount?: number
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
    imeOk?: boolean
    infra?: Record<string, string>
    overviewApiAt?: string
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

/** Full OHLC from TGJU, filtered from `fromGreg` (YYYY/MM/DD). Newest-first API → reverse. */
async function fetchTgjuOhlc(key: string, fromGreg = '2022/01/01'): Promise<CandlePoint[]> {
  try {
    const res = await fetch(`${TGJU_HIST}/${key}`, { headers: { Accept: 'application/json' } })
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
    const res = await fetch('/data/market.json', { cache: 'no-store' })
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
    const res = await fetch('https://api.tgju.org/v1/market/indicator/today-table-data/bourse?lang=fa', {
      headers: { Accept: 'application/json' },
    })
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
    const res = await fetch('/api/overview', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as OverviewApi
  } catch {
    return null
  }
}

const PULSE_SESSION_KEY = 'midco-pulse-history-v5'
export const PULSE_REFRESH_MS = 30 * 1000
export const PULSE_HIST_START = '08:45'
/** Cash equities / bond / equity-ETF board close. */
export const PULSE_CASH_END = '12:30'
/** Gold commodity ETFs keep trading into the afternoon (~18:00). */
export const PULSE_HIST_END = '18:00'

function clampPulseHistoryTime(hhmm: string | undefined | null): string | null {
  const t = String(hhmm || '')
  if (!/^\d{2}:\d{2}$/.test(t)) return null
  if (t < PULSE_HIST_START) return null
  if (t > PULSE_HIST_END) return PULSE_HIST_END
  return t
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

/** Forward-fill series values. Optional endLabel draws a flat tail to that time. */
export function densifyFlowSeries(
  points: Record<string, string | number | null | undefined>[],
  keys: string[],
  endLabel?: string,
): Record<string, string | number>[] {
  if (!points.length) return []
  const sorted = [...points].sort((a, b) => String(a.label).localeCompare(String(b.label)))
  const last: Record<string, number> = {}
  const out: Record<string, string | number>[] = []
  for (const p of sorted) {
    const next: Record<string, string | number> = { label: String(p.label) }
    for (const k of keys) {
      const raw = p[k]
      if (raw != null && raw !== '' && Number.isFinite(Number(raw))) last[k] = Number(raw)
      next[k] = last[k] ?? 0
    }
    out.push(next)
  }
  if (endLabel) {
    const lastPoint = out[out.length - 1]
    if (lastPoint && String(lastPoint.label) < endLabel) {
      const tail: Record<string, string | number> = { label: endLabel }
      for (const k of keys) tail[k] = lastPoint[k] ?? 0
      out.push(tail)
    }
  }
  return out
}

export async function fetchPulseApi(): Promise<{
  marketPulse?: DashboardData['overview']['marketPulse']
  marketPulseHistory: NonNullable<DashboardData['overview']['marketPulseHistory']>
} | null> {
  try {
    const res = await fetch('/api/pulse', { cache: 'no-store' })
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
    if (pars.retailMoneyFlowDailyBillionToman != null) {
      o.retailMoneyFlowDaily = pars.retailMoneyFlowDailyBillionToman
      sources.retailMoneyFlowDaily = 'parsistahlil-live'
    }
    notes.unshift(
      `پارسیس زنده: خرد=${pars.retailTradeValueBillionToman ?? '—'} · پول حقیقی=${pars.retailMoneyFlowDailyBillionToman ?? '—'} میلیارد تومان` +
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
  if (live.retailMoneyFlowDailyBillionToman != null) {
    o.retailMoneyFlowDaily = live.retailMoneyFlowDailyBillionToman
    sources.retailMoneyFlowDaily = 'parsistahlil'
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
  if (liveAny.marketPulse) o.marketPulse = liveAny.marketPulse
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

async function fetchMineralStocksApi(): Promise<MineralStockSnap[] | null> {
  const endpoints = ['/api/stocks', '/data/mineral_stocks.json']
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (!res.ok) continue
      const json = (await res.json()) as { ok?: boolean; stocks?: MineralStockSnap[] } | MineralStockSnap[]
      if (Array.isArray(json)) return json.length ? json : null
      if (json.stocks?.length) return json.stocks
    } catch {
      // try next
    }
  }
  return null
}

function applyMineralStockReturns(base: DashboardData, snaps: MineralStockSnap[] | null | undefined) {
  if (!snaps?.length) {
    // still attach symbols from universe
    for (const s of base.stocks) {
      if (s.isIndustry) continue
      const sym = MINERAL_SYMBOL_BY_NAME[s.name]
      if (sym) s.symbol = sym
    }
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

    if (snap.closePrice != null && snap.closePrice > 0) s.closePrice = snap.closePrice
    else if (snap.lastPrice != null && snap.lastPrice > 0) s.closePrice = snap.lastPrice
    if (snap.dailyPct != null && Number.isFinite(snap.dailyPct)) s.dailyPct = snap.dailyPct
    // Only overwrite period returns when adjusted series is fresh
    if (snap.returnsAdjusted) {
      if (snap.weekPct != null && Number.isFinite(snap.weekPct)) s.weekPct = snap.weekPct
      if (snap.monthPct != null && Number.isFinite(snap.monthPct)) s.monthPct = snap.monthPct
      if (snap.ytdPct != null && Number.isFinite(snap.ytdPct)) s.ytdPct = snap.ytdPct
      s.returnsAdjusted = true
      s.returnsSource = snap.returnsSource || 'shakhesban-adjusted-chart'
    }
    if (snap.volume != null && snap.volume > 0) s.volume = snap.volume
    if (snap.tradeValueMr != null && snap.tradeValueMr > 0) s.tradeValueMr = snap.tradeValueMr
    if (snap.marketValueBr != null && snap.marketValueBr > 0) {
      s.marketValueBr = snap.marketValueBr
      // ارزش دلاری: میلیارد ریال / نرخ دلار
      s.marketValueUsdM = Math.round((snap.marketValueBr * 1_000_000_000) / usd / 1_000_000)
    }
  }
}

export async function loadDashboardBundle(): Promise<LiveBundle> {
  const base: DashboardData = structuredClone(seedDashboard)
  const now = new Date().toISOString()

  const [current, histEntries, candleEntries, fredEntries, scraped, overviewApi, intradayFallback, stocksApi] =
    await Promise.all([
      fetchTgjuAjax(),
      Promise.all(HIST_KEYS.map(async (k) => [k, await fetchTgjuHistory(k)] as const)),
      Promise.all(HIST_KEYS.map(async (k) => [k, await fetchTgjuOhlc(k, '2022/01/01')] as const)),
      Promise.all(FRED_SERIES.map(async (s) => [s.mapTo || s.id, await fetchFred(s.id, s.label)] as const)),
      fetchScrapedMarket(),
      fetchOverviewApi(),
      fetchTgjuIntraday(),
      fetchMineralStocksApi(),
    ])

  const liveCount = applyLiveQuotes(base, current)
  const overviewLiveOk = applyOverviewLive(base, scraped?.overviewLive, scraped?.candles1401)
  const freshOk = applyFreshOverview(base, overviewApi, intradayFallback)
  applyMineralStockReturns(base, stocksApi || scraped?.mineralStocks)
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
      return {
        ...s,
        status: scraped?.meta?.imeOk ? 'live' : 'seed',
        note: scraped?.meta?.imeOk ? 'اسکرپر IME موفق' : 'IME از گزارش؛ اسکرپر کامل با IP ایران',
      }
    }
    return s
  })
  base.updatedAt = overviewApi?.updatedAt || now

  return {
    data: base,
    histories,
    candles,
    fred,
    sectors: scraped?.sectors || [],
    scrapeMeta: {
      ...(scraped?.meta || {}),
      overviewApiAt: overviewApi?.updatedAt,
    },
  }
}

export const REFRESH_MS = 2 * 60 * 1000
