import { motion } from 'framer-motion'
import { Activity, RefreshCw } from 'lucide-react'
import type { DashboardData } from '../data/types'
import { jalaliTodayTehran, timeFa } from '../lib/format'

const SECTIONS = [
  { id: 'overview', label: 'نمای بازار' },
  { id: 'stocks', label: 'سهام معدنی' },
  { id: 'nav', label: 'NAV پرتفو' },
  { id: 'commodities', label: 'کامودیتی' },
  { id: 'steel', label: 'زنجیره فولاد' },
  { id: 'periodic', label: 'تغییرات دوره‌ای' },
]

interface Props {
  data: DashboardData
  refreshing: boolean
  onRefresh: () => void
  active: string
}

export function Header({ data, refreshing, onRefresh, active }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-line)]/70 bg-[color-mix(in_oklab,var(--color-paper)_78%,transparent)] backdrop-blur-xl">
      <div className="shell flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ rotate: -12, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--color-ink)] text-[var(--color-copper)]"
            aria-hidden
          >
            <svg viewBox="0 0 64 64" className="h-7 w-7" fill="none">
              <path d="M14 42 L32 14 L50 42 Z" stroke="currentColor" strokeWidth="3.5" />
              <circle cx="32" cy="38" r="5" fill="currentColor" />
            </svg>
          </motion.div>
          <div>
            <div className="text-[0.95rem] font-extrabold tracking-tight text-[var(--color-ink)] sm:text-lg">
              توسعه معادن و فلزات
            </div>
            <div className="text-xs text-[var(--color-muted)]">
              داشبورد گزارش روزانه بازار · {jalaliTodayTehran() || data.overview.dateJalali}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="chip">
            <Activity className="h-3.5 w-3.5 text-[var(--color-copper)]" />
            بروزرسانی: <span className="num">{timeFa(data.updatedAt)}</span>
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white/70 px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] transition hover:border-[var(--color-copper)] hover:text-[var(--color-copper-deep)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            تازه‌سازی
          </button>
        </div>
      </div>

      <nav className="shell flex gap-1 overflow-x-auto pb-2" aria-label="بخش‌های داشبورد">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            data-active={active === s.id}
            className="nav-pill whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] transition hover:bg-white/60 hover:text-[var(--color-ink)] data-[active=true]:text-[var(--color-copper-deep)]"
          >
            {s.label}
          </a>
        ))}
      </nav>
    </header>
  )
}
