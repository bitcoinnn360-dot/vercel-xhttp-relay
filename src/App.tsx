import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { SourceBar } from './components/SourceBar'
import { MarketOverview } from './components/MarketOverview'
import { StocksSection } from './components/StocksSection'
import { NavSection } from './components/NavSection'
import { CommoditiesSection } from './components/CommoditiesSection'
import { SteelSection } from './components/SteelSection'
import { PeriodicSection } from './components/PeriodicSection'
import { useMarketData } from './hooks/useMarketData'

const SECTION_IDS = ['overview', 'stocks', 'nav', 'commodities', 'steel', 'periodic']

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
      { rootMargin: '-25% 0px -55% 0px', threshold: [0.15, 0.35, 0.6] },
    )

    nodes.forEach((n) => obs.observe(n))
    return () => obs.disconnect()
  }, [])

  return active
}

export default function App() {
  const { data, loading, refreshing, error, refresh } = useMarketData()
  const active = useActiveSection()

  return (
    <div className="pb-16">
      <Header
        data={data}
        refreshing={refreshing || loading}
        onRefresh={() => void refresh()}
        active={active}
      />

      <main className="shell mt-5 space-y-10">
        {error && (
          <div className="rounded-xl border border-[var(--color-neg)]/30 bg-[color-mix(in_oklab,var(--color-neg)_8%,white)] px-4 py-3 text-sm text-[var(--color-neg)]">
            {error} — داده‌های نمونه گزارش نمایش داده می‌شود.
          </div>
        )}

        <SourceBar sources={data.sources} />
        <MarketOverview data={data} />

        <StocksSection data={data} />
        <NavSection data={data} />
        <CommoditiesSection data={data} />
        <SteelSection data={data} />
        <PeriodicSection data={data} />

        <footer className="border-t border-[var(--color-line)] pt-6 text-center text-xs text-[var(--color-muted)]">
          <p>
            معاونت مالی و اقتصادی — واحد سرمایه‌گذاری · شرکت سرمایه‌گذاری توسعه معادن و فلزات
          </p>
          <p className="mt-1">
            داده‌های بورس (TSETMC) و فولاد چین (Custeel) در حالت نمونه از گزارش روزانه هستند تا دسترسی
            سازمانی فعال شود. کامودیتی‌ها در صورت دسترسی شبکه از TGJU به‌روز می‌شوند.
          </p>
        </footer>
      </main>
    </div>
  )
}
