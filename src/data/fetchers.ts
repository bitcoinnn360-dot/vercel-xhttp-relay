import type { CommodityQuote, DashboardData, SourceStatus } from './types'
import { seedDashboard } from './seed'

const TGJU_BASE = 'https://api.tgju.org/v1/market/indicator/summary-table-data'

/** Map TGJU endpoint keys → commodity ids in our dashboard */
const LIVE_KEYS: { key: string; id: string }[] = [
  { key: 'ons', id: 'ons' },
  { key: 'price_dollar_rl', id: 'price_dollar_rl' },
  { key: 'sekee', id: 'sekee' },
  { key: 'copper', id: 'copper' },
  { key: 'aluminium', id: 'aluminium' },
  { key: 'zinc', id: 'zinc' },
  { key: 'oil_brent', id: 'oil_brent' },
  { key: 'crypto-bitcoin', id: 'crypto-bitcoin' },
  { key: 'energy-natural-gas', id: 'energy-natural-gas' },
]

function parseFaNumber(raw: string): number {
  const cleaned = raw.replace(/,/g, '').replace(/[^\d.-]/g, '')
  return Number(cleaned)
}

function parseChangeSpan(html: string): number {
  const text = html.replace(/<[^>]+>/g, '').trim()
  return parseFaNumber(text)
}

interface TgjuRow {
  open: number
  low: number
  high: number
  close: number
  change: number
  changePct: number
  dateGregorian: string
  dateJalali: string
}

async function fetchTgjuLatest(key: string): Promise<TgjuRow | null> {
  try {
    const res = await fetch(`${TGJU_BASE}/${key}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: string[][] }
    const row = json.data?.[0]
    if (!row || row.length < 8) return null
    return {
      open: parseFaNumber(row[0]),
      low: parseFaNumber(row[1]),
      high: parseFaNumber(row[2]),
      close: parseFaNumber(row[3]),
      change: parseChangeSpan(row[4]),
      changePct: parseChangeSpan(row[5]),
      dateGregorian: row[6],
      dateJalali: row[7],
    }
  } catch {
    return null
  }
}

function mergeCommodity(
  existing: CommodityQuote,
  live: TgjuRow,
): CommodityQuote {
  const signedChange =
    live.changePct < 0 ? -Math.abs(live.change) : Math.abs(live.change)
  return {
    ...existing,
    value: live.close,
    change: signedChange,
    changePct: live.changePct,
    source: 'tgju',
    lastTradeJalali: live.dateJalali,
  }
}

export async function loadDashboard(): Promise<DashboardData> {
  const base: DashboardData = structuredClone(seedDashboard)
  const now = new Date().toISOString()

  const results = await Promise.all(
    LIVE_KEYS.map(async ({ key, id }) => {
      const row = await fetchTgjuLatest(key)
      return { id, row }
    }),
  )

  let liveCount = 0
  const commodities = base.commodities.map((c) => {
    const hit = results.find((r) => r.id === c.id && r.row)
    if (!hit?.row) return c
    liveCount += 1
    return mergeCommodity(c, hit.row)
  })

  // Keep USD rate on overview in sync when dollar is live
  const dollar = commodities.find((c) => c.id === 'price_dollar_rl')
  if (dollar?.source === 'tgju') {
    base.overview.usdRate = dollar.value
    if (base.overview.totalMarketValueHmt > 0) {
      base.overview.totalMarketValueUsdM = Math.round(
        (base.overview.totalMarketValueHmt * 1e10) / dollar.value / 1e6,
      )
    }
  }

  const sources: SourceStatus[] = base.sources.map((s) => {
    if (s.id === 'tgju') {
      return {
        ...s,
        status: liveCount > 0 ? 'live' : 'error',
        note:
          liveCount > 0
            ? `${liveCount} شاخص زنده از TGJU`
            : 'خطا در اتصال به TGJU — نمایش seed',
        lastOk: liveCount > 0 ? now : s.lastOk,
      }
    }
    return s
  })

  return {
    ...base,
    commodities,
    sources,
    updatedAt: now,
  }
}

export const REFRESH_MS = 5 * 60 * 1000
