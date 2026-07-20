import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDashboard, REFRESH_MS } from '../data/fetchers'
import type { DashboardData } from '../data/types'
import { seedDashboard } from '../data/seed'

export function useMarketData() {
  const [data, setData] = useState<DashboardData>(seedDashboard)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const next = await loadDashboard()
      if (!mounted.current) return
      setData(next)
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

  return { data, loading, refreshing, error, refresh }
}
