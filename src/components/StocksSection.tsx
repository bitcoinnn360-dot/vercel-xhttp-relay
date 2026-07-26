import { useMemo, useState } from 'react'
import type { DashboardData, StockRow } from '../data/types'
import { changeClass, fmtInt, fmtPct } from '../lib/format'

const GROUPS = ['همه', 'سرمایه‌گذاری', 'سنگ‌آهن', 'فولادی', 'مس', 'فلزات', 'کابل'] as const

export function StocksSection({ data }: { data: DashboardData }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('همه')

  const rows = useMemo(() => {
    if (group === 'همه') return data.stocks
    return data.stocks.filter((s) => s.group === group)
  }, [data.stocks, group])

  return (
    <section id="stocks" className="scroll-mt-28 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-title">وضعیت معاملات سهام شرکت‌های معدنی و فلزی</h2>
          <p className="section-sub">ارزش بازار، حجم، بازدهی روزانه تا سال جاری</p>
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
      <td className="font-semibold">{s.name}</td>
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

export function TopTrades({ data }: { data: DashboardData }) {
  const rows = (data.topTrades || []).filter((t) => (t.valueBr || 0) > 0).slice(0, 10)
  const max = Math.max(...rows.map((t) => t.valueBr), 1)
  return (
    <div className="panel p-4">
      <h3 className="mb-1 text-sm font-bold">بیشترین ارزش معاملات</h3>
      <p className="mb-3 text-[10px] text-[var(--color-muted)]">سهام بورس/فرابورس · میلیارد تومان</p>
      <ul className="space-y-2.5">
        {rows.map((t) => (
          <li key={t.name}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-semibold">{t.name}</span>
              <span className="num text-[var(--color-ink-soft)]">{fmtInt(t.valueBr)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-paper-2)]">
              <div
                className="h-full rounded-full bg-gradient-to-l from-[var(--color-copper)] to-[var(--color-steel)]"
                style={{ width: `${Math.max(4, (t.valueBr / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
        {!rows.length ? <li className="text-[11px] text-[var(--color-muted)]">در انتظار داده زنده</li> : null}
      </ul>
    </div>
  )
}
