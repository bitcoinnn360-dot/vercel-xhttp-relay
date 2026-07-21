import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDashboardBundle, REFRESH_MS, type FredBundle, type HistoryPoint } from '../data/fetchers'
import type { DashboardData } from '../data/types'
import { seedDashboard } from '../data/seed'

export function useMarketData() {
  const [data, setData] = useState<DashboardData>(seedDashboard)
  const [histories, setHistories] = useState<Record<string, HistoryPoint[]>>({})
  const [fred, setFred] = useState<Record<string, FredBundle>>({})
  const [sectors, setSectors] = useState<
    { name: string; color: string; count: number; avgChangePct: number; members: string[] }[]
  >([])
  const [scrapeMeta, setScrapeMeta] = useState<{
    updatedAt?: string
    tsetmcOk?: boolean
    imeOk?: boolean
    infra?: Record<string, string>
  }>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const bundle = await loadDashboardBundle()
      if (!mounted.current) return
      setData(bundle.data)
      setHistories(bundle.histories)
      setFred(bundle.fred)
      setSectors(bundle.sectors)
      setScrapeMeta(bundle.scrapeMeta)
      setError(null)
    } catch (e) {
      if (!mounted.current) return
      setError(e instanceof Error ? e.message : 'خطا در بارگذاری داده')
    } finally {
      if (mounted.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const id = window.setInterval(() => void refresh(true), REFRESH_MS)
    return () => {
      mounted.current = false
      window.clearInterval(id)
    }
  }, [refresh])

  return { data, histories, fred, sectors, scrapeMeta, loading, refreshing, error, refresh }
}
