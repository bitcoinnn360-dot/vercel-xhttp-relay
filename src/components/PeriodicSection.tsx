import type { DashboardData, PeriodicRow } from '../data/types'
import { changeClass, fmtNum, fmtPct } from '../lib/format'

export function PeriodicSection({ data }: { data: DashboardData }) {
  const steel = data.periodic.filter((r) => r.group === 'steel')
  const macro = data.periodic.filter((r) => r.group === 'macro')

  return (
    <section id="periodic" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">تغییرات دوره‌ای</h2>
        <p className="section-sub">هفتگی · ماهانه · سالانه — زنجیره فولاد و شاخص‌های جهانی</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <PeriodicTable title="تغییرات دوره‌ای زنجیره فولاد چین و ایران" rows={steel} showDaily={false} />
        <PeriodicTable title="تغییرات دوره‌ای شاخص‌های مهم بازارهای جهانی" rows={macro} showDaily />
      </div>
    </section>
  )
}

function PeriodicTable({
  title,
  rows,
  showDaily,
}: {
  title: string
  rows: PeriodicRow[]
  showDaily: boolean
}) {
  return (
    <div className="panel overflow-x-auto p-2 sm:p-3">
      <h3 className="mb-2 px-2 pt-2 text-sm font-bold">{title}</h3>
      <table className="data-table min-w-[520px]">
        <thead>
          <tr>
            <th>کالا</th>
            <th>قیمت</th>
            <th>واحد</th>
            {showDaily && <th>روزانه</th>}
            <th>هفتگی</th>
            <th>ماهانه</th>
            <th>YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="font-semibold">{r.name}</td>
              <td className="num">{fmtNum(r.price, r.price >= 1000 ? 0 : 2)}</td>
              <td className="text-[var(--color-muted)] whitespace-nowrap">{r.unit}</td>
              {showDaily && (
                <td className={`num ${changeClass(r.dailyPct ?? 0)}`}>
                  {r.dailyPct === undefined ? '—' : fmtPct(r.dailyPct)}
                </td>
              )}
              <td className={`num ${changeClass(r.weeklyPct)}`}>{fmtPct(r.weeklyPct)}</td>
              <td className={`num ${changeClass(r.monthlyPct)}`}>{fmtPct(r.monthlyPct)}</td>
              <td className={`num font-semibold ${changeClass(r.yoyPct)}`}>{fmtPct(r.yoyPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
