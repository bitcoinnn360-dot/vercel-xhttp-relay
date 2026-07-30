import { Activity, RefreshCw } from 'lucide-react'
import type { DashboardData } from '../../data/types'
import { jalaliTodayTehran, timeFa } from '../../lib/format'

const NAV = [
  { id: 'overview', label: 'نمای بازار' },
  { id: 'charts', label: 'نمودار کامودیتی‌ها' },
  { id: 'stocks', label: 'سهام معدنی و فلزی ایران' },
  { id: 'global', label: 'بازار جهانی' },
  { id: 'nav', label: 'NAV پرتفو' },
  { id: 'commodities', label: 'کامودیتی' },
  { id: 'steel', label: 'زنجیره فولاد' },
  { id: 'periodic', label: 'تغییرات دوره‌ای' },
  { id: 'market-asia', label: 'مرکز بازارها' },
]

interface Props {
  data: DashboardData
  refreshing: boolean
  onRefresh: () => void
  active: string
}

function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 42 L32 14 L50 42 Z" stroke="currentColor" strokeWidth="3.5" fill="none" />
      <circle cx="32" cy="38" r="5" fill="currentColor" />
    </svg>
  )
}

export function Sidebar({ active }: { active: string }) {
  return (
    <aside className="side-nav">
      <div className="side-brand">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-[#7dd3fc]">
          <BrandMark size={24} />
        </div>
        <div>
          <div className="text-sm font-extrabold text-white leading-tight">معادن و فلزات</div>
          <div className="text-[0.65rem] text-slate-300">Market Terminal</div>
        </div>
      </div>
      {NAV.map((n) => (
        <a key={n.id} href={`#${n.id}`} data-active={active === n.id} className="side-link">
          {n.label}
        </a>
      ))}
      <div className="mt-auto px-2 pt-4 text-[0.65rem] leading-5 text-slate-400">
        سبک الهام‌گرفته از ترمینال‌های تحلیلی مثل GuruFocus
        <br />
        بروزرسانی خودکار هر ۱ دقیقه
      </div>
    </aside>
  )
}

/** Compact sticky nav for viewports where the sidebar is hidden. */
export function MobileNav({ active }: { active: string }) {
  return (
    <nav className="mobile-nav" aria-label="بخش‌های داشبورد">
      <div className="mobile-nav-brand">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-white/10 text-[#7dd3fc]">
          <BrandMark size={20} />
        </div>
        <div>
          <div className="text-sm font-extrabold text-white leading-tight">معادن و فلزات</div>
          <div className="text-[0.65rem] text-slate-300">Market Terminal</div>
        </div>
      </div>
      <div className="mobile-nav-links">
        {NAV.map((n) => (
          <a key={n.id} href={`#${n.id}`} data-active={active === n.id}>
            {n.label}
          </a>
        ))}
      </div>
    </nav>
  )
}

export function TopBar({ data, refreshing, onRefresh }: Omit<Props, 'active'>) {
  const dateLabel = jalaliTodayTehran() || data.overview.dateJalali
  return (
    <div className="gf-head">
      <div>
        <h1 className="text-lg font-extrabold text-[var(--color-brand)] sm:text-xl">
          داشبورد گزارش روزانه بازار
        </h1>
        <p className="text-xs text-[var(--color-muted)]">
          شرکت سرمایه‌گذاری توسعه معادن و فلزات · {dateLabel}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip">
          <Activity className="h-3.5 w-3.5 text-[var(--color-brand-2)]" />
          <span className="num">{timeFa(data.updatedAt)}</span>
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          بروزرسانی
        </button>
      </div>
    </div>
  )
}
