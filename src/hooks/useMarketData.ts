import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyPulseToDashboard,
  fetchPulseApi,
  loadDashboardBundle,
  loadOverviewPreview,
  PULSE_REFRESH_MS,
  REFRESH_MS,
  type FredBundle,
  type HistoryPoint,
} from '../data/fetchers'
import type { CandlePoint, DashboardData } from '../data/types'
import { seedDashboard } from '../data/seed'

export function useMarketData() {
  const [data, setData] = useState<DashboardData>(seedDashboard)
  const [histories, setHistories] = useState<Record<string, HistoryPoint[]>>({})
  const [candles, setCandles] = useState<Record<string, CandlePoint[]>>({})
  const [fred, setFred] = useState<Record<string, FredBundle>>({})
  const [sectors, setSectors] = useState<
    { name: string; color: string; count: number; avgChangePct: number; members: string[] }[]
  >([])
  const [scrapeMeta, setScrapeMeta] = useState<{
    updatedAt?: string
    tsetmcOk?: boolean
    imeOk?: boolean
    infra?: Record<string, string>
    overviewApiAt?: string
  }>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const hasLiveBourseViewStocks = useRef(false)
  const hasLiveOverview = useRef(false)


  const refreshOverviewFirst = useCallback(async () => {
    try {
      const quick = await loadOverviewPreview()
      // The full bundle may have already delivered newer live values while this
      // lightweight request was in flight. Never let it overwrite them.
      if (!mounted.current || hasLiveOverview.current) return
      setData((previous) => ({
        ...previous,
        overview: quick.overview,
        impacts: quick.impacts,
        topTrades: quick.topTrades,
        updatedAt: quick.updatedAt,
      }))
    } catch {
      /* The full refresh below still has its own independent fallbacks. */
    }
  }, [])

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const bundle = await loadDashboardBundle()
      if (!mounted.current) return
      // Guard: never apply a payload that would blank the overview panels
      const impacts = bundle.data?.impacts
      if (
        !impacts ||
        !Array.isArray(impacts.boursePos) ||
        !Array.isArray(impacts.bourseNeg) ||
        !Array.isArray(impacts.ifbPos) ||
        !Array.isArray(impacts.ifbNeg)
      ) {
        bundle.data.impacts = seedDashboard.impacts
        if (bundle.data.overview) bundle.data.overview.impactsLive = false
      }
      const receivedLiveStocks = Boolean(bundle.scrapeMeta.stocksLive)
      const receivedLiveOverview = Boolean(bundle.scrapeMeta.overviewApiAt)
      const receivedLiveNav = Boolean(bundle.scrapeMeta.navLive)
      const receivedLiveProduction = Boolean(bundle.scrapeMeta.productionLive)
      const receivedLiveFinancials = Boolean(bundle.scrapeMeta.financialsLive)
      setData((previous) => {
        const sameSession = previous.overview.dateJalali === bundle.data.overview.dateJalali
        // A transient stock API failure used to replace the live table with the
        // bundled seed on every minute refresh. Keep the last good table for the
        // same market day until a newer live snapshot arrives.
        if (sameSession && !receivedLiveStocks && hasLiveBourseViewStocks.current) {
          bundle.data.stocks = previous.stocks
        }
        if (sameSession && !receivedLiveNav && previous.holdings.length) {
          bundle.data.holdings = previous.holdings
          bundle.data.nav = previous.nav
        }
        if (sameSession && !receivedLiveProduction && previous.productionOps.companies.length) {
          bundle.data.productionOps = previous.productionOps
        }
        if (sameSession && !receivedLiveFinancials && previous.financials.companies.length) {
          bundle.data.financials = previous.financials
        }
        if (sameSession && !receivedLiveOverview && hasLiveOverview.current) {
          bundle.data.overview = {
            ...previous.overview,
            marketPulse: bundle.data.overview.marketPulse || previous.overview.marketPulse,
            marketPulseHistory:
              bundle.data.overview.marketPulseHistory?.length
                ? bundle.data.overview.marketPulseHistory
                : previous.overview.marketPulseHistory,
          }
        }
        if (sameSession && !bundle.data.overview.marketPulse && previous.overview.marketPulse) {
          bundle.data.overview.marketPulse = previous.overview.marketPulse
        }
        if (
          sameSession &&
          !bundle.data.overview.marketPulseHistory?.length &&
          previous.overview.marketPulseHistory?.length
        ) {
          bundle.data.overview.marketPulseHistory = previous.overview.marketPulseHistory
        }
        return bundle.data
      })
      if (receivedLiveStocks) hasLiveBourseViewStocks.current = true
      if (receivedLiveOverview) hasLiveOverview.current = true
      setHistories((previous) => ({ ...previous, ...bundle.histories }))
      setCandles((previous) => ({ ...previous, ...(bundle.candles || {}) }))
      setFred(bundle.fred)
      setSectors(bundle.sectors)
      setScrapeMeta(bundle.scrapeMeta)
      setError(null)
    } catch (e) {
      if (!mounted.current) return
      // Keep previous UI on refresh failure; only surface error text
      setError(e instanceof Error ? e.message : 'خطا در بارگذاری داده')
    } finally {
      if (mounted.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  const refreshPulse = useCallback(async () => {
    try {
      const pulse = await fetchPulseApi()
      if (!mounted.current || !pulse) return
      setData((prev) => applyPulseToDashboard(prev, pulse))
    } catch {
      /* keep last good pulse */
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refreshOverviewFirst()
    void refresh()
    const id = window.setInterval(() => void refresh(true), REFRESH_MS)
    const pulseId = window.setInterval(() => void refreshPulse(), PULSE_REFRESH_MS)
    // first pulse tick shortly after load so charts start densifying
    const firstPulse = window.setTimeout(() => void refreshPulse(), 2500)
    // The first cold /api/overview request can be slower than its cache hit.
    // Retry it automatically so opening the dashboard never needs a manual refresh.
    const overviewRetry = window.setTimeout(() => void refreshOverviewFirst(), 9000)
    return () => {
      mounted.current = false
      window.clearInterval(id)
      window.clearInterval(pulseId)
      window.clearTimeout(firstPulse)
      window.clearTimeout(overviewRetry)
    }
  }, [refresh, refreshOverviewFirst, refreshPulse])

  return { data, histories, candles, fred, sectors, scrapeMeta, loading, refreshing, error, refresh }
}
