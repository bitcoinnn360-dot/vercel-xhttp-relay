import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { DashboardData, StockRow } from '../data/types'
import { changeClass, fmtInt, fmtNum, fmtPct } from '../lib/format'
import { TopTradesBarChart } from './charts/Charts'

const GROUPS = ['همه', 'سرمایه‌گذاری', 'سنگ‌آهن', 'فولادی', 'مس', 'کابل'] as const

type SortKey = 'marketValueBr' | 'dailyPct' | 'weekPct' | 'netIndividualBt'

export function StocksSection({ data }: { data: DashboardData }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('همه')
  const [sortKey, setSortKey] = useState<SortKey>('marketValueBr')

  const rows = useMemo(() => {
    const filtered =
      group === 'همه' ? data.stocks : data.stocks.filter((s) => s.group === group)

    // Keep industry rows at end of each group; sort equities within group
    const groups = new Map<string, { eq: StockRow[]; ind?: StockRow }>()
    for (const s of filtered) {
      const g = s.group || '—'
      if (!groups.has(g)) groups.set(g, { eq: [] })
      const bucket = groups.get(g)!
      if (s.isIndustry) bucket.ind = s
      else bucket.eq.push(s)
    }

    const out: StockRow[] = []
    for (const [, bucket] of groups) {
      bucket.eq.sort((a, b) => {
        const av = Number(a[sortKey]) || 0
        const bv = Number(b[sortKey]) || 0
        return bv - av
      })
      out.push(...bucket.eq)
      if (bucket.ind) out.push(bucket.ind)
    }
    return out
  }, [data.stocks, group, sortKey])

  const liveCount = rows.filter((s) => s.returnsSource && !s.isIndustry).length
  const adjustedCount = rows.filter((s) => s.returnsAdjusted && !s.isIndustry).length
  const flowSum = rows
    .filter((s) => !s.isIndustry)
    .reduce((a, s) => a + (s.netIndividualBt || 0), 0)

  return (
    <section id="stocks" className="scroll-mt-28 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-title">وضعیت معاملات سهام شرکت‌های معدنی و فلزی</h2>
          <p className="section-sub">
            بورس‌ویو · پایانی / تعدیلی
            {liveCount
              ? adjustedCount
                ? ` · ${adjustedCount} نماد · خالص حقیقی امروز ${fmtNum(flowSum, 1)} م‌ت`
                : ` · ${liveCount} نماد`
              : ' · در حال دریافت…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[10px] text-[var(--color-muted)]">مرتب‌سازی</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-lg border border-[var(--color-line)] bg-white/80 px-2 py-1 text-xs"
          >
            <option value="marketValueBr">ارزش بازار</option>
            <option value="dailyPct">بازدهی روز</option>
            <option value="weekPct">بازدهی هفته</option>
            <option value="netIndividualBt">خالص حقیقی</option>
          </select>
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  group === g
                    ? 'bg-[var(--color-ink)] text-white'
                    : 'border border-[var(--color-line)] bg-white/60 text-[var(--color-ink-soft)] hover:border-[var(--color-copper)]'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel overflow-x-auto p-2 sm:p-3">
        <table className="data-table stocks-table min-w-[1100px]">
          <thead>
            <tr>
              <th>گروه</th>
              <th>نام / نماد</th>
              <th>ارزش بازار</th>
              <th>دلاری (m$)</th>
              <th>حجم</th>
              <th>ارزش معاملات</th>
              <th>پایانی</th>
              <th>روز</th>
              <th>هفته</th>
              <th>ماه</th>
              <th>سال</th>
              <th>خالص حقیقی</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <StockTr key={`${s.group}-${s.name}`} s={s} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function FlowCell({ value, industry }: { value?: number; industry?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <td className="num">—</td>
  const abs = Math.abs(value)
  const width = Math.min(100, Math.round((abs / Math.max(abs, 80)) * 100))
  return (
    <td className={`num flow-cell ${changeClass(value)}`}>
      <div className="flow-bar-wrap" aria-hidden>
        <span
          className={`flow-bar ${value >= 0 ? 'in' : 'out'}`}
          style={{ width: industry ? '100%' : `${Math.max(12, width)}%` }}
        />
      </div>
      <span className="relative z-[1] font-semibold">{fmtNum(value, 1)}</span>
    </td>
  )
}

function StockTr({ s }: { s: StockRow }) {
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={s.isIndustry ? 'industry' : s.halted ? 'halted' : undefined}
    >
      <td>{s.group}</td>
      <td className="font-semibold name-cell">
        {s.name}
        {s.symbol ? (
          <span className="symbol-tag">({s.symbol})</span>
        ) : null}
        {s.halted ? <span className="halt-tag">متوقف</span> : null}
        {!s.isIndustry && s.returnsAdjusted ? <span className="adj-tag">تعدیل</span> : null}
      </td>
      <td className="num">{s.marketValueBr ? fmtInt(s.marketValueBr) : '—'}</td>
      <td className="num">{s.marketValueUsdM ? fmtInt(s.marketValueUsdM) : '—'}</td>
      <td className="num">{s.isIndustry || s.volume == null ? (s.isIndustry ? fmtInt(s.volume || 0) : '—') : fmtInt(s.volume)}</td>
      <td className="num">{s.tradeValueMr ? fmtInt(s.tradeValueMr) : '—'}</td>
      <td className="num">{s.isIndustry || !s.closePrice ? '—' : fmtInt(s.closePrice)}</td>
      <td className={`num font-semibold ${changeClass(s.dailyPct)}`}>{fmtPct(s.dailyPct)}</td>
      <td className={`num ${changeClass(s.weekPct)}`}>{fmtPct(s.weekPct)}</td>
      <td className={`num ${changeClass(s.monthPct)}`}>{fmtPct(s.monthPct)}</td>
      <td className={`num ${changeClass(s.ytdPct)}`}>{fmtPct(s.ytdPct)}</td>
      <FlowCell value={s.netIndividualBt} industry={s.isIndustry} />
    </motion.tr>
  )
}

/** Exclude bonds/sukuk/debt instruments that sometimes leak into trade rankings. */
function isBondLikeSymbol(name: string): boolean {
  const n = String(name || '').trim()
  if (!n) return true
  if (/^اراد\d*/i.test(n)) return true
  if (/^اخزا\d*/i.test(n)) return true
  if (/^اجاره/i.test(n)) return true
  if (/^مرابحه/i.test(n)) return true
  if (/^ص[ا-ی]{2,}/.test(n) && /\d{2,}$/.test(n)) return true
  if (/\d{2,}$/.test(n) && /(?:اراد|صبا|طبیعت|آسمان|سامان|گستر|قرن)/.test(n)) return true
  return false
}

export function TopTrades({ data }: { data: DashboardData }) {
  const rows = (data.topTrades || [])
    .filter((t) => (t.valueBr || 0) > 0 && !isBondLikeSymbol(t.name))
    .slice(0, 12)
  const total = rows.reduce((a, t) => a + (t.valueBr || 0), 0)
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className="panel p-4"
    >
      <h3 className="mb-1 text-sm font-bold">بیشترین ارزش معاملات</h3>
      <p className="mb-2 text-[10px] text-[var(--color-muted)]">
        ۱۲ نماد برتر · همان جدول ارزش معاملات TradersArena (زیر حقیقی/حقوقی)
      </p>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[10px] text-[var(--color-muted)]">
        <span>رتبه‌بندی زنده · tradersarena.ir/data/mainwatch/symbols</span>
        {total > 0 ? (
          <span>
            جمع ۱۲تای اول:{' '}
            <span className="num font-semibold text-[var(--color-ink-soft)]">{fmtInt(total)}</span>
          </span>
        ) : null}
      </div>
      <TopTradesBarChart rows={rows} height={360} />
    </motion.div>
  )
}
