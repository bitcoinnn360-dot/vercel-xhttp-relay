import { useEffect, useState } from 'react'
import { Sidebar, TopBar } from './components/layout/Shell'
import { SourceBar } from './components/SourceBar'
import { MarketOverview } from './components/MarketOverview'
import { ChartsHub, FredMacroSection } from './components/ChartsHub'
import { StocksSection } from './components/StocksSection'
import { NavSection } from './components/NavSection'
import { CommoditiesSection } from './components/CommoditiesSection'
import { SteelSection } from './components/SteelSection'
import { PeriodicSection } from './components/PeriodicSection'
import { useMarketData } from './hooks/useMarketData'

const SECTION_IDS = ['overview', 'charts', 'stocks', 'nav', 'commodities', 'steel', 'periodic', 'macro']

function useActiveSection() {
  const [active, setActive] = useState('overview')
  useEffect(() => {
    const nodes = SECTION_IDS.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    if (!nodes.length) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target?.id) setActive(visible.target.id)
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0.12, 0.35, 0.55] },
    )
    nodes.forEach((n) => obs.observe(n))
    return () => obs.disconnect()
  }, [])
  return active
}

export default function App() {
  const { data, histories, fred, loading, refreshing, error, refresh } = useMarketData()
  const active = useActiveSection()

  return (
    <div className="app-shell">
      <Sidebar active={active} />
      <div>
        <main className="main-wrap">
          <TopBar data={data} refreshing={refreshing || loading} onRefresh={() => void refresh()} />
          {error && (
            <div className="mb-4 rounded-lg border border-[var(--color-neg)]/30 bg-red-50 px-4 py-3 text-sm text-[var(--color-neg)]">
              {error}
            </div>
          )}
          <div className="space-y-10">
            <SourceBar sources={data.sources} />
            <MarketOverview data={data} histories={histories} />
            <ChartsHub data={data} histories={histories} fred={fred} />
            <StocksSection data={data} />
            <NavSection data={data} />
            <CommoditiesSection data={data} />
            <SteelSection data={data} />
            <PeriodicSection data={data} />
            <FredMacroSection fred={fred} />
            <footer className="border-t border-[var(--color-line)] pt-5 text-center text-xs text-[var(--color-muted)]">
              <p>معاونت مالی و اقتصادی — واحد سرمایه‌گذاری · توسعه معادن و فلزات</p>
              <p className="mt-1">
                منابع: TGJU (بورس/کامودیتی) · FRED (کلان) · گزارش روزانه (NAV/IME) · جایگزین موقت Custeel تا اشتراک
              </p>
            </footer>
          </div>
        </main>
      </div>
    </div>
  )
}
