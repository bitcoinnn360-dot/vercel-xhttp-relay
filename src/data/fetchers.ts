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
  { id: 'DCOILBRENTEU', label: 'Ù†ÙØª Ø¨Ø±Ù†Øª (FRED)', mapTo: 'oil_brent' },
  { id: 'PIORECRUSDM', label: 'Ø³Ù†Ú¯â€ŒØ¢Ù‡Ù† FRED', mapTo: 'fred_iron_ore' },
  { id: 'PCOPPUSDM', label: 'Ù…Ø³ FRED', mapTo: 'fred_copper' },
  { id: 'DTWEXBGS', label: 'Ø´Ø§Ø®Øµ Ø¯Ù„Ø§Ø±', mapTo: 'fred_dxy' },
  { id: 'DGS10', label: 'Ø§ÙˆØ±Ø§Ù‚ Û±Û°Ø³Ø§Ù„Ù‡ Ø¢Ù…Ø±ÛŒÚ©Ø§', mapTo: 'fred_dgs10' },
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
  /** Ø®Ø§Ù„Øµ Ø®Ø±ÛŒØ¯ Ø­Ù‚ÛŒÙ‚ÛŒ â€” Ù…ÛŒÙ„ÛŒØ§Ø±Ø¯ ØªÙˆÙ…Ø§Ù† */
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

/** Full OHLC from TGJU, filtered from `fromGreg` (YYYY/MM/DD). Newest-first API â†’ reverse. */
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
 * Ø´Ø§Ø®Øµ Ú©Ù„ Ø±Ø§ Ø§Ø² Pages Function Ø¨Ø®ÙˆØ§Ù† ØªØ§ CORS/timeout Ù…Ø±ÙˆØ±Ú¯Ø± Ø¨Ø§Ø¹Ø« Ù†Ø§Ù‚Øµ Ø´Ø¯Ù†
 * ØªØ§Ø±ÛŒØ®Ú†Ù‡ Ù†Ø´ÙˆØ¯. Function Ù†ØªÛŒØ¬Ù‡Ù” Ù…Ø¹ØªØ¨Ø± Ø±Ø§ Ú©Ø´ Ù…ÛŒâ€ŒÚ©Ù†Ø¯Ø› TGJU Ù…Ø³ØªÙ‚ÛŒÙ… ÙÙ‚Ø· Ù¾Ø´ØªÛŒØ¨Ø§Ù† Ø§Ø³Øª.
 */
async function fetchBourseOhlc(): Promise<CandlePoint[]> {
  try {
    const res = await fetchWithTimeout('/api/index-history', 7000, { cache: 'no-store' })
    if (res.ok) {
      const json = (await res.json()) as { candles?: CandlePoint[] }
      if (Array.isArray(json.candles) && json.candles.length) return json.candles
    }
  } catch {
    // TGJU Ù…Ø³ØªÙ‚ÛŒÙ… Ø¯Ø± Ù¾Ø§ÛŒÛŒÙ† Ù†Ù‚Ø´ Ù¾Ø´ØªÛŒØ¨Ø§Ù† Ø¯Ø§Ø±Ø¯.
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
      c.name = 'Ø³Ù†Ú¯â€ŒØ¢Ù‡Ù† (Ø¬Ø§ÛŒÚ¯Ø²ÛŒÙ† Custeel)'
      c.unit = 'Ø¯Ù„Ø§Ø±/ØªÙ†'
    }
  }
  if (current['base-us-steel-coil'] && !base.commodities.find((c) => c.id === 'base-us-steel-coil')) {
    patchCommodity('base-us-steel-coil', 'base-us-steel-coil')
    const c = base.commodities.find((x) => x.id === 'base-us-steel-coil')
    if (c) {
      c.name = 'ÙˆØ±Ù‚ Ú¯Ø±Ù… Ø¢Ù…Ø±ÛŒÚ©Ø§'
      c.unit = 'Ø¯Ù„Ø§Ø±/ØªÙ†'
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
        note: liveCount > 0 ? `${liveCount} Ø´Ø§Ø®Øµ Ø²Ù†Ø¯Ù‡ (Ø¨ÙˆØ±Ø³ + Ú©Ø§Ù…ÙˆØ¯ÛŒØªÛŒ)` : 'Ø®Ø·Ø§ Ø¯Ø± TGJU',
        lastOk: liveCount > 0 ? now : s.lastOk,
      }
    }
    if (s.id === 'tradingeconomics') {
      return {
        ...s,
        status: fredOk > 0 ? 'live' : 'seed',
        note: fredOk > 0 ? `FRED Â· ${fredOk} Ø³Ø±ÛŒ` : 'FRED Ø§Ø² /api/fred â€” Ù†ÛŒØ§Ø² Ø¨Ù‡ Ø¯ÛŒÙ¾Ù„ÙˆÛŒ Pages',
        lastOk: fredOk > 0 ? now : s.lastOk,
      }
    }
    if (s.id === 'custeel') {
      return {
        ...s,
        status: liveCount > 0 ? 'live' : 'seed',
        note: 'Ù„Ø§Ú¯ÛŒÙ† Ø§Ø´ØªØ±Ø§Ú© â€” Ù‚ÛŒÙ…Øª Ø²Ù†Ø¬ÛŒØ±Ù‡ Ú†ÛŒÙ† (Ø§Ø³Ú©Ø±Ù¾Ø± /api/steel)',
        lastOk: liveCount > 0 ? no×}·ŞÚ$z{-®éÜj×f–ÇFW"‚‡2’Óâ2æw&÷WÓÓÒr¢ç6÷'B‚†Â"’Óâ†"æÖ&¶WEfÇVT'"ÇÂ’Ò†æÖ&¶WEfÇVT'"ÇÂ’¢–b‚ÖVÖ&W'2æÆVæwF‚’6öçF–çVP¢&V'V–ÇBçW6‚‚ââæÖVÖ&W'2 ¢6öç7B×bÒÖVÖ&W'2ç&VGV6R‚†Â2’Óâ²‡2æÖ&¶WEfÇVT'"ÇÂ’Â¢6öç7BW6BÒÖVÖ&W'2ç&VGV6R‚†Â2’Óâ²‡2æÖ&¶WEfÇVUW6DÒÇÂ’Â¢6öç7BföÂÒÖVÖ&W'2ç&VGV6R‚†Â2’Óâ²‡2çföÇVÖRÇÂ’Â¢6öç7BGbÒÖVÖ&W'2ç&VGV6R‚†Â2’Óâ²‡2çG&FUfÇVT×"ÇÂ’Â¢6öç7BæWBÒÖVÖ&W'2ç&VGV6R‚†Â2’Óâ²‡2ææWD–æF—f–GVÄ'BÇÂ’Â¢6öç7BvVV´fÆ÷rÒvw&VvFUvVV´fÆ÷w2†ÖVÖ&W'2 ¢&V'V–ÇBçW6‚‡°¢w&÷W¢rÀ¢æÖS¢‹]˜m‹Š¢G¶wÖÀ¢—4–æGW7G'“¢G'VRÀ¢Ö&¶WEfÇVT'#¢×bÀ¢Ö&¶WEfÇVUW6DÓ¢W6BÀ¢föÇVÖS¢föÂÀ¢G&FUfÇVT×#¢GbÀ¢6Æ÷6U&–6S¢À¢F–Ç•7C¢vV–v‡FVE7B†ÖVÖ&W'2ÂvF–Ç•7Br’À¢vVVµ7C¢vV–v‡FVE7B†ÖVÖ&W'2ÂwvVVµ7Br’À¢ÖöçF…7C¢vV–v‡FVE7B†ÖVÖ&W'2ÂvÖöçF…7Br’À¢—FE7C¢vV–v‡FVE7B†ÖVÖ&W'2Âw—FE7Br’À¢–V#7C¢vV–v‡FVE7B†ÖVÖ&W'2Âw–V#7Br’À¢–V#57C¢vV–v‡FVE7B†ÖVÖ&W'2Âw–V#57Br’À¢æWD–æF—f–GVÄ'C¢ÖF‚ç&÷VæB†æWB¢’òÀ¢æWD–æF—f–GVÅvVV´'C¢vVV´fÆ÷rÀ¢&WGW&ç4F§W7FVC¢ÖVÖ&W'2ç6öÖR‚‡2’Óâ2ç&WGW&ç4F§W7FVB’À¢&WGW&ç56÷W&6S¢v–æGW7G'’×vV–v‡FVBrÀ¢Ò¢Ğ ¢f÷"†6öç7B2öbWV—F–W2’°¢–b‚4T5Dõ%ôõ$DU"æ–æ6ÇVFW2‡2æw&÷W2‡G—Vöb4T5Dõ%ôõ$DU"•¶çVÖ&W%Ò’’&V'V–ÇBçW6‚‡2¢Ğ¢&6Rç7Fö6·2Ò&V'V–Ç@§Ğ ¦gVæ7F–öâÇ”Ö–æW&Å7Fö6µ&WGW&ç2†&6S¢F6†&ö&DFFÂ6æ3¢Ö–æW&Å7Fö6µ6æµÒÂçVÆÂÂVæFVf–æVB’°¢–b‚6æ3òæÆVæwF‚’°¢f÷"†6öç7B2öb&6Rç7Fö6·2’°¢–b‡2æ—4–æGW7G'’’6öçF–çVP¢6öç7B7–ÒÒÔ”äU$Åõ5”Ô$ôÅô%•ôäÔU·2ææÖUĞ¢–b‡7–Ò’2ç7–Ö&öÂÒ7–Ğ¢Ğ¢&V'V–ÆD–æGW7G'•&÷w2†&6R¢&WGW&à¢Ğ¢6öç7B'•7–ÒÒæWrÖ‡6æ2æÖ‚‡"’Óâ·"ç7–Ö&öÂÂ%Ò’ ¢6öç7BW6BÒ&6Ræ÷fW'f–WrçW6E&FRÇÂ6VVDF6†&ö&Bæ÷fW'f–WrçW6E&FRÇÂ¢f÷"†6öç7B2öb&6Rç7Fö6·2’°¢–b‡2æ—4–æGW7G'’’6öçF–çVP¢6öç7B7–ÒÒÔ”äU$Åõ5”Ô$ôÅô%•ôäÔU·2ææÖUĞ¢–b‡7–Ò’2ç7–Ö&öÂÒ7–Ğ¢6öç7B6æÒ7–Òò'•7–ÒævWB‡7–Ò’¢VæFVf–æV@¢–b‚6æ’6öçF–çVP¢òò6¶—FVB’7GV'2†W‡—&VB&÷W'6Uf–Wr6öö¶–RWF2â’6ò6VVB÷7FF–27F’f—6–&ÆRà¢–b‡6æç&WGW&ç56÷W&6RÓÓÒvW'&÷"rbb6ææ6Æ÷6U&–6RÓÒçVÆÂbb6æç—FE7BÓÒçVÆÂ’6öçF–çVP ¢–b‡6ææ6Æ÷6U&–6RÒçVÆÂbb6ææ6Æ÷6U&–6Râ’2æ6Æ÷6U&–6RÒ6ææ6Æ÷6U&–6P¢VÇ6R–b‡6ææÆ7E&–6RÒçVÆÂbb6ææÆ7E&–6Râ’2æ6Æ÷6U&–6RÒ6ææÆ7E&–6P¢–b‡6ææF–Ç•7BÒçVÆÂbbçVÖ&W"æ—4f–æ—FR‡6ææF–Ç•7B’’2æF–Ç•7BÒ6ææF–Ç•7@¢–b‡6æçvVVµ7BÒçVÆÂbbçVÖ&W"æ—4f–æ—FR‡6æçvVVµ7B’’2çvVVµ7BÒ6æçvVVµ7@¢–b‡6ææÖöçF…7BÒçVÆÂbbçVÖ&W"æ—4f–æ—FR‡6ææÖöçF…7B’’2æÖöçF…7BÒ6ææÖöçF…7@¢–b‡6æç—FE7BÒçVÆÂbbçVÖ&W"æ—4f–æ—FR‡6æç—FE7B’’2ç—FE7BÒ6æç—FE7@¢–b‡6æç–V#7BÒçVÆÂbbçVÖ&W"æ—4f–æ—FR‡6æç–V#7B’’2ç–V#7BÒ6æç–V#7@¢–b‡6æç–V#57BÒçVÆÂbbçVÖ&W"æ—4f–æ—FR‡6æç–V#57B’’2ç–V#57BÒ6æç–V#57@¢–b‡6æç&WGW&ç56÷W&6R’°¢2ç&WGW&ç4F§W7FVBÒ&ööÆVâ‡6æç&WGW&ç4F§W7FVB¢2ç&WGW&ç56÷W&6RÒ6æç&WGW&ç56÷W&6P¢Ğ¢–b‡6ææ†ÇFVBÒçVÆÂ’2æ†ÇFVBÒ6ææ†ÇFV@¢–b‡6æçföÇVÖRÒçVÆÂ’2çföÇVÖRÒ6æçföÇVÖP¢–b‡6æçG&FUfÇVT×"ÒçVÆÂ’2çG&FUfÇVT×"Ò6æçG&FUfÇVT× ¢–b‡6æææWD–æF—f–GVÄ'BÒçVÆÂbbçVÖ&W"æ—4f–æ—FR‡6æææWD–æF—f–GVÄ'B’’°¢2ææWD–æF—f–GVÄ'BÒ6æææWD–æF—f–GVÄ'@¢Ğ¢–b„'&’æ—4'&’‡6æææWD–æF—f–GVÅvVV´'B’bb6æææWD–æF—f–GVÅvVV´'BæÆVæwF‚’°¢2ææWD–æF—f–GVÅvVV´'BÒ6æææWD–æF—f–GVÅvVV´'@¢Ğ¢–b‡6ææg&VTfÆöE7BÒçVÆÂbbçVÖ&W"æ—4f–æ—FR‡6ææg&VTfÆöE7B’’2æg&VTfÆöE7BÒ6ææg&VTfÆöE7@¢–b‡6ææ÷WG7FæF–æu6†&W2ÒçVÆÂ’2æ÷WG7FæF–æu6†&W2Ò6ææ÷WG7FæF–æu6†&W0¢–b‡6æçföÇVÖUFôfÆöE7BÒçVÆÂbbçVÖ&W"æ—4f–æ—FR‡6æçföÇVÖUFôfÆöE7B’’°¢2çföÇVÖUFôfÆöE7BÒ6æçföÇVÖUFôfÆöE7@¢Ğ¢–b‡6ææÖ&¶WEfÇVT'"ÒçVÆÂbb6ææÖ&¶WEfÇVT'"â’°¢2æÖ&¶WEfÇVT'"Ò6ææÖ&¶WEfÇVT' ¢2æÖ&¶WEfÇVUW6DÒÒÖF‚ç&÷VæB‚‡6ææÖ&¶WEfÇVT'"¢óóó’òW6Bòóó¢Ğ¢Ğ¢&V'V–ÆD–æGW7G'•&÷w2†&6R§Ğ ¦W‡÷'B7–æ2gVæ7F–öâÆöDF6†&ö&D'VæFÆR‚“¢&öÖ—6SÄÆ—fT'VæFÆSâ°¢6öç7B&6S¢F6†&ö&DFFÒ7G'V7GW&VD6ÆöæR‡6VVDF6†&ö&B¢6öç7Bæ÷rÒæWrFFR‚’çFô•4õ7G&–ær‚ ¢6öç7B¶7W'&VçBÂ†—7DVçG&–W2Â6æFÆTVçG&–W2Âg&VDVçG&–W2Â67&VBÂ÷fW'f–Wt’Â–çG&F”fÆÆ&6²Â7Fö6·4’Â7FVVÄ’Âæd’ÂvÆö&Ä’Â&öGV7F–öä’Âf–ææ6–Ç4’Â&WF–ÄÖöæW”fÆ÷t†—7F÷'•ÒĞ¢v—B&öÖ—6RæÆÂ…°¢fWF6…Fv§T¦‚‚’À¢&öÖ—6RæÆÂ„„•5Eô´U•2æÖ†7–æ2†²’Óâ¶²Âv—BfWF6…Fv§T†—7F÷'’†²•Ò26öç7B’’À¢&öÖ—6RæÆÂ€¢„•5Eô´U•2æÖ†7–æ2†²’Óâ¶²Â²ÓÓÒv&÷W'6Rròv—BfWF6„&÷W'6Tö†Æ2‚’¢v—BfWF6…Fv§Tö†Æ2†²Âs##"óór•Ò26öç7B’À¢’À¢&öÖ—6RæÆÂ„e$TEõ4U$”U2æÖ†7–æ2‡2’Óâ·2æÖFòÇÂ2æ–BÂv—BfWF6„g&VB‡2æ–BÂ2æÆ&VÂ•Ò26öç7B’’À¢fWF6…67&VDÖ&¶WB‚’À¢fWF6„÷fW'f–Wt’‚’À¢fWF6…Fv§T–çG&F’‚’À¢fWF6„Ö–æW&Å7Fö6·4’‚’À¢fWF6…7FVVÄ6†–ä’‚’À¢fWF6„æd’‚’À¢fWF6„vÆö&ÄÖ&¶WG4’‚’À¢fWF6…&öGV7F–öä÷4’‚’À¢fWF6„f–ææ6–Ç4’‚’À¢fWF6…&WF–ÄÖöæW”fÆ÷t†—7F÷'’‚’À¢Ò ¢6öç7BÆ—fT6÷VçBÒÇ”Æ—fUV÷FW2†&6RÂ7W'&VçB¢6öç7B÷fW'f–WtÆ—fTö²ÒÇ”÷fW'f–WtÆ—fR†&6RÂ67&VCòæ÷fW'f–WtÆ—fRÂ67&VCòæ6æFÆW3C¢6öç7Bg&W6„ö²ÒÇ”g&W6„÷fW'f–Wr†&6RÂ÷fW'f–Wt’Â–çG&F”fÆÆ&6²¢6öç7BÖ–æW&Å7Fö6µ&÷w2Ò7Fö6·4“òæÆVæwF‚ò7Fö6·4’¢çVÆÀ¢–b†Ö–æW&Å7Fö6µ&÷w2’Ç”Ö–æW&Å7Fö6µ&WGW&ç2†&6RÂÖ–æW&Å7Fö6µ&÷w2¢VÇ6R&6Rç7Fö6·2ÒµĞ¢6öç7B7FVVÅ7FGW2ÒÇ•7FVVÄ6†–â†&6RÂ7FVVÄ’¢6öç7Bædö²ÒÇ”ædÆ—fR†&6RÂæd’¢–b‚ædö²’°¢&6Ræ†öÆF–æw2ÒµĞ¢&6Ræ÷fW'f–Wræf–VÆE6÷W&6W2Ò²âââ†&6Ræ÷fW'f–Wræf–VÆE6÷W&6W2ÇÂ·Ò’Âæc¢v&÷W'6Wf–Wr×Væf–Æ&ÆRrĞ¢Ğ¢6öç7BvÆö&Äö²ÒÇ”vÆö&ÄÖ&¶WG2†&6RÂvÆö&Ä’¢6öç7B&öGV7F–öäö²ÒÇ•&öGV7F–öä÷2†&6RÂ&öGV7F–öä’¢–b‚&öGV7F–öäö²’&6Rç&öGV7F–öä÷2Ò²ö³¢fÇ6RÂ6ö×æ–W3¢µÒÂ6÷W&6S¢v&÷W'6Wf–WrrĞ¢6öç7Bf–ææ6–Ç4ö²ÒÇ”f–ææ6–Ç2†&6RÂf–ææ6–Ç4’¢–b‚f–ææ6–Ç4ö²’&6Ræf–ææ6–Ç2Ò²ö³¢fÇ6RÂ6ö×æ–W3¢µÒÂ6÷W&6S¢v&÷W'6Wf–WrrĞ¢6öç7B”–×7G2Òæ÷&ÖÆ—¦T–×7G2†÷fW'f–Wt“òæ–×7G2¢–b†”–×7G2bb†÷fW'f–Wt“òæ–×7G4g&öÕ6÷W&6T&VæÇÂ÷fW'f–Wt“òæ–×7G4g&öÕ&†f&BÇÂ÷fW'f–Wt“òæ–×7G56÷W&6R’’°¢&6Ræ–×7G2Ò”–×7G0¢&6Ræ÷fW'f–Wræ–×7G4Æ—fRÒG'VP¢&6Ræ÷fW'f–Wræf–VÆE6÷W&6W2Ò°¢âââ†&6Ræ÷fW'f–Wræf–VÆE6÷W&6W2ÇÂ·Ò’À¢–×7G3¢÷fW'f–Wt“òæ–×7G56÷W&6RÇÂ†÷fW'f–Wt“òæ–×7G4g&öÕ&†f&Bòw&†f&C3cRr¢w6÷W&6V&VæÖÆ—fRr’À¢Ğ¢Ğ¢–b†÷fW'f–Wt“òçF÷G&FW3òæÆVæwF‚’°¢&6RçF÷G&FW2Ò÷fW'f–Wt’çF÷G&FW0¢&6Ræ÷fW'f–Wræf–VÆE6÷W&6W2Ò°¢âââ†&6Ræ÷fW'f–Wræf–VÆE6÷W&6W2ÇÂ·Ò’À¢F÷G&FW3¢÷fW'f–Wt’çF÷G&FW56÷W&6RÇÂw6÷W&6V&VæÖÆÂrÀ¢Ğ¢Ğ¢–b†÷fW'f–Wt“òæFFT¦ÆÆ’’°¢&6Ræ÷fW'f–WræFFT¦ÆÆ’Ò÷fW'f–Wt’æFFT¦ÆÆ¢Ğ¢–b†÷fW'f–Wt“òæÖ&¶WEVÇ6R’°¢&6Ræ÷fW'f–WræÖ&¶WEVÇ6RÒ÷fW'f–Wt’æÖ&¶WEVÇ6P¢Ğ¢–b†÷fW'f–Wt“òæÖ&¶WEVÇ6T†—7F÷'“òæÆVæwF‚’°¢&6Ræ÷fW'f–WræÖ&¶WEVÇ6T†—7F÷'’Ò÷fW'f–Wt’æÖ&¶WEVÇ6T†—7F÷'¢Ğ¢òòÇ6òg&öÒ67&VBÖ&¶WBæ§6öâv†Vâ’F†–à¢6öç7B67&VEVÇ6RÒ67&VCòæÖ&¶WEVÇ6P¢–b‚&6Ræ÷fW'f–WræÖ&¶WEVÇ6Rbb67&VEVÇ6Sòæ7W'&VçB’°¢&6Ræ÷fW'f–WræÖ&¶WEVÇ6RÒ67&VEVÇ6Ræ7W'&Vç@¢Ğ¢–b‚&6Ræ÷fW'f–WræÖ&¶WEVÇ6T†—7F÷'“òæÆVæwF‚bb67&VEVÇ6Sòæ†—7F÷'“òæÆVæwF‚’°¢&6Ræ÷fW'f–WræÖ&¶WEVÇ6T†—7F÷'’Ò67&VEVÇ6Ræ†—7F÷'¢Ğ¢Ç•&WF–ÄÖöæW”fÆ÷t†—7F÷'’†&6RÂ&WF–ÄÖöæW”fÆ÷t†—7F÷'’¢òòFVç6–g’v—F‚6W76–öå7F÷&vR†6Æ–VçB'V–ÆG2“£(i&æ÷r6W&–W2v†–ÆRvR—2÷Vâ¢°¢6öç7B6W76–öâÒ&VE6W76–öåVÇ6R‚¢6öç7BFFT¦ÆÆ’Ğ¢&6Ræ÷fW'f–WræÖ&¶WEVÇ6SòæFFT¦ÆÆ’ÇÂ÷fW'f–Wt“òæFFT¦ÆÆ’ÇÂ6W76–öâæFFT¦ÆÆ¢–b‡6W76–öâæFFT¦ÆÆ’bbFFT¦ÆÆ’bb6W76–öâæFFT¦ÆÆ’ÓÒFFT¦ÆÆ’’°¢6W76–öâæ†—7F÷'’ÒµĞ¢Ğ¢6öç7B†—7BÒÖW&vUVÇ6Uö–çG2‡6W76–öâæ†—7F÷'’Â&6Ræ÷fW'f–WræÖ&¶WEVÇ6T†—7F÷'’¢w&—FU6W76–öåVÇ6R†FFT¦ÆÆ’Â†—7B¢–b††—7BæÆVæwF‚’&6Ræ÷fW'f–WræÖ&¶WEVÇ6T†—7F÷'’Ò†—7@¢Ğ ¢6öç7B†—7F÷&–W3¢&V6÷&CÇ7G&–ærÂ†—7F÷'•ö–çEµÓâÒ²âââ‡67&VCòæ†—7F÷&–W2ÇÂ·Ò’Ğ¢f÷"†6öç7B¶²ÂG5Òöb†—7DVçG&–W2’°¢–b†²ÓÓÒv&÷W'6Rrbb††—7F÷&–W2æ&÷W'6SòæÆVæwF‚ÇÂ’âG2æÆVæwF‚’6öçF–çVP¢–b‡G2æÆVæwF‚’†—7F÷&–W5¶µÒÒG0¢Ğ¢òòÖW&vR7W7FVVÂ7FVVÂ†—7F÷&–W2f÷"6†'G4‡V"ò7FVVÅ6V7F–öà¢–b‡7FVVÄ“òæ†—7F÷&–W2’°¢f÷"†6öç7B¶–BÂG5Òöbö&¦V7BæVçG&–W2‡7FVVÄ’æ†—7F÷&–W2’’°¢–b‚G3òæÆVæwF‚’6öçF–çVP¢†—7F÷&–W5¶7FVVÃ¢G¶–GÖÒÒG2æÖ‚‡’Óâ‡²FFS¢æFFRÂfÇVS¢çfÇVRÒ’¢Ğ¢Ğ ¢6öç7B6æFÆW3¢&V6÷&CÇ7G&–ærÂ6æFÆUö–çEµÓâÒ²âââ‡67&VCòæ6æFÆT†—7F÷&–W2ÇÂ·Ò’Ğ¢f÷"†6öç7B¶²ÂG5Òöb6æFÆTVçG&–W2’°¢–b‡G2æÆVæwF‚’6æFÆW5¶µÒÒG0¢VÇ6R–b‚6æFÆW5¶µÓòæÆVæwF‚bb†—7F÷&–W5¶µÓòæÆVæwF‚’°¢òòFVw&FS¢7–çF†W6—¦RfÆB6æFÆW2g&öÒ6Æ÷6RÖöæÇ’†—7F÷'¢6æFÆW5¶µÒÒ†—7F÷&–W5¶µÒæÖ‚‡’Óâ‡°¢FFS¢æFFRÀ¢FFT¦ÆÆ“¢æFFT¦ÆÆ’À¢÷Vã¢çfÇVRÀ¢†–vƒ¢çfÇVRÀ¢Æ÷s¢çfÇVRÀ¢6Æ÷6S¢çfÇVRÀ¢Ò’¢Ğ¢Ğ¢6æFÆW2æ&÷W'6RÒv—F„7W'&VçEFVG—„6æFÆR†6æFÆW2æ&÷W'6RÇÂµÒÂ&6Ræ÷fW'f–WrÂ7W'&VçBæ&÷W'6R¢òòÖ&¶WD÷fW'f–Wr˜m˜]˜ŠıŠ}‹Š­Š}‹¸ÍŠí¸Â‹ŠrŠ}‹"÷fW'f–Wræ6æFÆW3C˜]¸Î(ÍŠí˜Š}˜mŠı‰°¢òòŠŠı˜˜bŠ}¸Í˜bŠ}Š­‹]Š}˜MˆÂŠıŠ}Šı˜}™B‹-˜mŠı˜}™BDt¥R˜mŠ}Šı¸ÍŠı˜rªı‹˜Š­˜r˜‚˜Š}¸Í˜BŠ}¸Í‹=Š­Šr˜m˜]Š}¸Í‹BŠıŠ}Šı˜r˜]¸Î(Í‹MŠòà¢–b†6æFÆW2æ&÷W'6SòæÆVæwF‚’&6Ræ÷fW'f–Wræ6æFÆW3CÒ6æFÆW2æ&÷W'6P ¢f÷"†6öç7B2öb&6Ræ6öÖÖöF—F–W2’°¢6öç7B†—7D¶W’Ò2æ–BÓÓÒv&6R×W2Ö—&öâÖ÷&Rròv&6R×W2Ö—&öâÖ÷&Rr¢2æ–@¢6öç7BG2Ò†—7F÷&–W5¶†—7D¶W•Ğ¢–b‡G3òæÆVæwF‚’°¢2æ†—7F÷'’ÒG2ç6Æ–6R‚ÓC’æÖ‚‡’Óâ‡²C¢æFFT¦ÆÆ’ÇÂæFFRÂc¢çfÇVRÒ’¢Ğ¢Ğ ¢–b††—7F÷&–W2æ&÷W'6SòæÆVæwF‚’°¢&6Ræ÷fW'f–Wræ–æFW„†—7F÷'’Ò†—7F÷&–W2æ&÷W'6Rç6Æ–6R‚Ó3b’æÖ‚‡’Óâ‡°¢FFS¢æFFT¦ÆÆ’ÇÂæFFRÀ¢fÇVS¢çfÇVRÀ¢Ò’¢–b‚&6Ræ÷fW'f–Wræ–çG&F”–æFWƒòæÆVæwF‚ÇÂ&6Ræ÷fW'f–Wræ–çG&F”–æFW‚æÆVæwF‚ÂR’°¢&6Ræ÷fW'f–Wræ–çG&F”–æFW‚Ò†—7F÷&–W2æ&÷W'6Rç6Æ–6R‚Ó"’æÖ‚‡Â’’Óâ‡°¢F–ÖS¢æFFT¦ÆÆ’ÇÂG¶—ÖÀ¢fÇVS¢çfÇVRÀ¢Ò’¢Ğ¢Ğ ¢6öç7Bg&VC¢&V6÷&CÇ7G&–ærÂg&VD'VæFÆSâÒ·Ğ¢ÆWBg&VDö²Ò ¢f÷"†6öç7B¶ÖFòÂ'VæFÆUÒöbg&VDVçG&–W2’°¢–b†'VæFÆR’°¢g&VE¶ÖFõÒÒ'VæFÆP¢g&VDö²³Ò¢Ğ¢Ğ ¢–b†g&VBæg&VEöG‡“òæÆ7BÒçVÆÂ’°¢6öç7B&÷rÒ&6RçW&–öF–2æf–æB‚‡’ÓâææÖRÓÓÒ}‹MŠ}Ší‹RŠı˜MŠ}‹r¢–b‡&÷r’°¢&÷rç&–6RÒg&VBæg&VEöG‡’æÆ7@¢&÷ræF–Ç•7BÒg&VBæg&VEöG‡’æ6†ævU7@¢Ğ¢Ğ¢–b†g&VBæg&VEöFw3òæÆ7BÒçVÆÂ’°¢6öç7B&÷rÒ&6RçW&–öF–2æf–æB‚‡’ÓâææÖRÓÓÒ}Š}˜‹Š}˜"˜-‹‹m˜rŠ-˜]‹¸ÍªŠrr¢–b‡&÷r’°¢&÷rç&–6RÒg&VBæg&VEöFw3æÆ7@¢&÷ræF–Ç•7BÒg&VBæg&VEöFw3æ6†ævU7@¢Ğ¢Ğ ¢&6Rç6÷W&6W2ÒÖ&µ6÷W&6W2†&6RÂÆ—fT6÷VçBÂg&VDö²Âæ÷r¢6öç7B†5'2Ò&ööÆVâ€¢&6Ræ÷fW'f–Wrç&WF–ÄÖöæW”fÆ÷tF–Ç’ÒçVÆÂÇÂ&6Ræ÷fW'f–Wrç&WF–ÅG&FUfÇVT&–ÆÆ–öåFöÖâÒçVÆÂÀ¢¢6öç7B†4&Væ×bÒ&ööÆVâ€¢÷fW'f–Wt“òçF÷FÄÖ&¶WEfÇVT†×BÒçVÆÂÇÀ¢‡67&VCòæ÷fW'f–WtÆ—fSòæÖ&¶WEfÇVU6÷W&6RÇÂrr’æ–æ6ÇVFW2‚w6÷W&6V&Vær’À¢¢–b†÷fW'f–WtÆ—fTö²ÇÂg&W6„ö²’°¢&6Rç6÷W&6W2Ò°¢ââæ&6Rç6÷W&6W2æf–ÇFW"€¢‡2’Óâ2æ–BÓÒw6†¶†W6&ârbb2æ–BÓÒw'6—7F†Æ–Ârbb2æ–BÓÒwG6WFÖ2rbb2æ–BÓÒw6÷W&6V&VærÀ¢’À¢°¢–C¢w6÷W&6V&VærÀ¢æÖS¢u6÷W&6T&VæòG&FW'4&VærÀ¢7FGW3¢†4&Væ×bòvÆ—fRr¢v&Æö6¶VBrÀ¢æ÷FS¢†4&Væ×`¢òŠ}‹‹-‹BŠŠ}‹-Š}‹Š˜‹‹2½˜‹Š}Š˜‹‹2G°¢÷fW'f–Wt“òçF÷FÄÖ&¶WEfÇVT†×BÒçVÆÂò+rG¶÷fW'f–Wt’çF÷FÄÖ&¶WEfÇVT†×GÒ˜}˜]Š¦¢rp¢Ö ¢¢}Šı‹¸Íª’˜mªıŠ}˜rŠí˜Š}˜mŠı˜r˜m‹MŠòrÀ¢Æ7Dö³¢†4&Væ×bò÷fW'f–Wt“òçWFFVDBÇÂ67&VCòæ÷fW'f–WtÆ—fSòæ4öbÇÂæ÷r¢VæFVf–æVBÀ¢ÒÀ¢°¢–C¢w6†¶†W6&ârÀ¢æÖS¢}‹MŠ}Ší‹^(ÍŠŠ}˜brÀ¢7FGW3¢vÆ—fRrÀ¢æ÷FS¢}˜}˜^(Í˜‹-˜b²˜‹Š}Š˜‹‹2„’‹-˜mŠı˜ròŠ}‹=ª‹›í‹’rÀ¢Æ7Dö³¢÷fW'f–Wt“òçWFFVDBÇÂ67&VCòæ÷fW'f–WtÆ—fSòæ4öbÇÂæ÷rÀ¢ÒÀ¢°¢–C¢w'6—7F†Æ–ÂrÀ¢æÖS¢}›íŠ}‹‹=¸Í‹>(ÍŠ­Šİ˜M¸Í˜BrÀ¢7FGW3¢†5'2òvÆ—fRr¢v&Æö6¶VBrÀ¢æ÷FS¢†5'0¢ò˜]‹Š}˜]˜MŠ}Š¢Ší‹Šò²›í˜˜BŠİ˜-¸Í˜-¸ÂG¶÷fW'f–Wt“òç'6—7F†Æ–ÃòæFFT¦ÆÆ’ò+rG¶÷fW'f–Wt’ç'6—7F†Æ–ÂæFFT¦ÆÆ—Ö¢rwÖ ¢¢÷fW'f–Wt“òç'6—7F†Æ–ÃòæW'&÷"ÇÂ}ªı‹-Š}‹‹B˜‹m‹¸ÍŠ¢ŠŠ}‹-Š}‹Ší˜Š}˜mŠı˜r˜m‹MŠòrÀ¢Æ7Dö³¢†5'2ò÷fW'f–Wt“òçWFFVDBÇÂæ÷r¢VæFVf–æVBÀ¢ÒÀ¢Ğ¢Ğ¢&6Rç6÷W&6W2Ò&6Rç6÷W&6W2æÖ‚‡2’Óâ°¢–b‡2æ–BÓÓÒv–ÖRr’°¢6öç7BÆ—fT–ÖRÒ7FVVÅ7FGW2æ–ÖTö²ÇÂ67&VCòæÖWFòæ–ÖTö°¢&WGW&â°¢ââç2À¢7FGW3¢Æ—fT–ÖRòvÆ—fRr¢v&Æö6¶VBrÀ¢æ÷FS¢Æ—fT–ÖP¢ò}Š-˜]Š}‹˜¸Í‹-¸Íª¸ÂöffW"×7FBp¢¢t”ÔRŠ}‹"Š}¸Í˜b˜]Šİ¸Í‹rŠı‹Šı‹=Š­‹‹2˜m¸Í‹=Š¢(	BŠ}‹=ª‹›í‹ŠŠr•Š}¸Í‹Š}˜brÀ¢Ğ¢Ğ¢–b‡2æ–BÓÓÒw–†öòr’°¢6öç7BâÒ&6RævÆö&ÄÖ&¶WG2ç7Fö6·2æÆVæwF€¢&WGW&â°¢ââç2À¢7FGW3¢vÆö&Äö²òvÆ—fRr¢w6VVBrÀ¢æ÷FS¢vÆö&Äö°¢òG¶çÒ˜m˜]Š}Šò+rG¶&6RævÆö&ÄÖ&¶WG2ç6V7F÷%W&f÷&Öæ6SòæÆVæwF‚ÇÂÒ‹=ªŠ­˜‹+rG¶&6RævÆö&ÄÖ&¶WG2æÖFW&–Ç4'”6÷VçG'“òæÆVæwF‚ÇÂÒ˜]˜Š}Šòıª‹M˜‹ ¢¢u–†öòf–ææ6R˜}˜m˜‹"˜M˜Šò˜m‹MŠı˜rrÀ¢Æ7Dö³¢vÆö&Äö²ò&6RævÆö&ÄÖ&¶WG2çWFFVDBÇÂæ÷r¢2æÆ7Dö²À¢Ğ¢Ğ¢&WGW&â0¢Ò¢–b‡&öGV7F–öäö²’°¢6öç7BâÒ&6Rç&öGV7F–öä÷2æ6ö×æ–W2æÆVæwF€¢6öç7B†2Ò&6Rç6÷W&6W2ç6öÖR‚‡2’Óâ2æ–BÓÓÒv&÷W'6Wf–WrÖ÷2r¢6öç7B&÷s¢6÷W&6U7FGW2Ò°¢–C¢v&÷W'6Wf–WrÖ÷2rÀ¢æÖS¢}Š˜‹‹>(Í˜¸Í˜‚+rŠ­˜˜M¸ÍŠòıŠ}˜m‹©¸ÂrÀ¢7FGW3¢vÆ—fRrÀ¢æ÷FS¢G¶çÒ‹M‹ªŠ¢›í‹Š­˜˜‚+rŠ­˜˜M¸ÍŠò˜]Š}˜}Š}˜m˜r²Š-Š‚ıŠ‹˜"ıªıŠ}‹&À¢Æ7Dö³¢&6Rç&öGV7F–öä÷2çWFFVDBÇÂæ÷rÀ¢Ğ¢&6Rç6÷W&6W2Ò†0¢ò&6Rç6÷W&6W2æÖ‚‡2’Óâ‡2æ–BÓÓÒv&÷W'6Wf–WrÖ÷2rò&÷r¢2’¢¢²ââæ&6Rç6÷W&6W2Â&÷uĞ¢Ğ¢&6RçWFFVDBÒ÷fW'f–Wt“òçWFFVDBÇÂ7FVVÄ“òçWFFVDBÇÂ&6RævÆö&ÄÖ&¶WG2çWFFVDBÇÂæ÷p ¢&WGW&â°¢FF¢&6RÀ¢†—7F÷&–W2À¢6æFÆW2À¢g&VBÀ¢6V7F÷'3¢67&VCòç6V7F÷'2ÇÂµÒÀ¢67&TÖWF¢°¢âââ‡67&VCòæÖWFÇÂ·Ò’À¢7Fö6·4Æ—fS¢&ööÆVâ€¢Ö–æW&Å7Fö6µ&÷w3òç6öÖR€¢‡&÷r’Óà¢&÷rç&WGW&ç56÷W&6RÓÒvW'&÷"rb`¢‚‡&÷ræ6Æ÷6U&–6RÒçVÆÂbb&÷ræ6Æ÷6U&–6Râ’ÇÀ¢‡&÷ræÆ7E&–6RÒçVÆÂbb&÷ræÆ7E&–6Râ’ÇÀ¢&÷ræF–Ç•7BÒçVÆÂ’À¢’À¢’À¢÷fW'f–Wt”C¢÷fW'f–Wt“òçWFFVDBÀ¢7W7FVVÄö³¢7FVVÅ7FGW2æ7W7FVVÄö²À¢–ÖTö³¢7FVVÅ7FGW2æ–ÖTö²ÇÂ67&VCòæÖWFòæ–ÖTö²À¢ÒÀ¢Ğ§Ğ ¦W‡÷'B6öç7B$Te$U4…ôÕ2Òc¢ 