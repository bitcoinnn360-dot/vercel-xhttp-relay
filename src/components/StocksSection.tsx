import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { DashboardData, StockRow } from '../data/types'
import { changeClass, fmtInt, fmtPct } from '../lib/format'
import { TopTradesBarChart } from './charts/Charts'

const GROUPS = ['همه', 'سرمایه‌گذاری', 'سنگ‌آهن', 'فولادی', 'مس', 'فلزات', 'کابل'] as const

export function StocksSection({ data }: { data: DashboardData }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('همه')

  const rows = useMemo(() => {
    if (group === 'همه') return data.stocks
    return data.stocks.filter((s) => s.group === group)
  }, [data.stocks, group])

  const adjustedCount = rows.filter((s) => s.returnsAdjusted && !s.isIndustry).length

  return (
    <section id="stocks" className="scroll-mt-28 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-title">وضعیت معاملات سهام شرکت‌های معدنی و فلزی</h2>
          <p className="section-sub">
            ارزش بازار، حجم، بازدهی روزانه تا سال جاری
            {adjustedCount
              ? ` · بازدهی هفته/ماه/سال از قیمت تعدیل‌شده شاخص‌بان (${adjustedCount} نماد)`
              : ' · بازدهی دوره‌ای پس از بارگذاری نمودار تعدیل‌شده'}
          </p>
        </div>
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

      <div className="panel overflow-x-auto p-2 sm:p-3">
        <table className="data-table min-w-[980px]">
          <thead>
            <tr>
              <th>گروه</th>
              <th>نام شرکت</th>
              <th>ارزش بازار (میلیارد ریال)</th>
              <th>ارزش دلاری (m$)</th>
              <th>حجم</th>
              <th>ارزش معاملات</th>
              <th>قیمت پایانی</th>
              <th>روزانه</th>
              <th>هفته</th>
              <th>ماه</th>
              <th>سال جاری</th>
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

function StockTr({ s }: { s: StockRow }) {
  return (
    <tr className={s.isIndustry ? 'industry' : undefined}>
      <td>{s.group}</td>
      <td className="font-semibold">
        {s.name}
        {s.symbol ? (
          <span className="mr-1 text-[10px] font-normal text-[var(--color-muted)]">({s.symbol})</span>
        ) : null}
        {s.returnsAdjusted ? (
          <span className="mr-1 text-[9px] font-semibold text-emerald-700" title={s.returnsSource || 'تعدیل‌شده'}>
            تعدیل‌شده
          </span>
        ) : null}
      </td>
      <td className="num">{s.isIndustry ? '—' : fmtInt(s.marketValueBr)}</td>
      <td className="num">{s.isIndustry ? '—' : fmtInt(s.marketValueUsdM)}</td>
      <td className="num">{s.isIndustry || !s.volume ? '—' : fmtInt(s.volume)}</td>
      <td className="num">{s.isIndustry || !s.tradeValueMr ? '—' : fmtInt(s.tradeValueMr)}</td>
      <td className="num">{s.isIndustry || !s.closePrice ? '—' : fmtInt(s.closePrice)}</td>
      <td className={`num font-semibold ${changeClass(s.dailyPct)}`}>{fmtPct(s.dailyPct)}</td>
      <td className={`num ${changeClass(s.weekPct)}`}>{fmtPct(s.weekPct)}</td>
      <td className={`num ${changeClass(s.monthPct)}`}>{fmtPct(s.monthPct)}</td>
      <td className={`num ${changeClass(s.ytdPct)}`}>{fmtPct(s.ytdPct)}</td>
    </tr>
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
  if (/^ص[ا-ی]{2,}/.test(n) && /\d{2,}$/.test(n)) return true // صکوک با پسوند عددی
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
