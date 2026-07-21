import type { FredBundle, HistoryPoint } from '../data/fetchers'
import type { DashboardData } from '../data/types'
import { PriceAreaChart } from './charts/Charts'

function toSeries(points?: HistoryPoint[]) {
  return (points || []).map((p) => ({
    label: (p.dateJalali || p.date || '').slice(5),
    value: p.value,
  }))
}

export function ChartsHub({
  histories,
  fred,
}: {
  data: DashboardData
  histories: Record<string, HistoryPoint[]>
  fred: Record<string, FredBundle>
}) {
  const blocks: { title: string; color: string; series: { label: string; value: number }[] }[] = [
    { title: 'شاخص کل بورس (TGJU)', color: '#0b3d6e', series: toSeries(histories.bourse) },
    { title: 'انس طلا', color: '#b45309', series: toSeries(histories.ons) },
    { title: 'دلار آزاد', color: '#0e7490', series: toSeries(histories.price_dollar_rl) },
    { title: 'سکه بهار آزادی', color: '#a16207', series: toSeries(histories.sekee) },
    { title: 'مس جهانی', color: '#b45309', series: toSeries(histories.copper) },
    { title: 'آلومینیوم', color: '#475569', series: toSeries(histories.aluminium) },
    { title: 'روی جهانی', color: '#64748b', series: toSeries(histories.zinc) },
    { title: 'نفت برنت', color: '#1e3a5f', series: toSeries(histories.oil_brent) },
    { title: 'بیت‌کوین', color: '#c2410c', series: toSeries(histories['crypto-bitcoin']) },
    { title: 'سنگ‌آهن (جایگزین Custeel)', color: '#334155', series: toSeries(histories['base-us-iron-ore']) },
    { title: 'ورق گرم آمریکا', color: '#1a5f9e', series: toSeries(histories['base-us-steel-coil']) },
  ]

  if (fred.fred_iron_ore?.history?.length) {
    blocks.push({
      title: 'سنگ‌آهن ماهانه FRED',
      color: '#0f766e',
      series: fred.fred_iron_ore.history.map((h) => ({ label: h.date.slice(2, 7), value: h.value })),
    })
  }
  if (fred.fred_dxy?.history?.length) {
    blocks.push({
      title: 'شاخص دلار FRED',
      color: '#1d4ed8',
      series: fred.fred_dxy.history.map((h) => ({ label: h.date.slice(5), value: h.value })),
    })
  }
  if (fred.fred_dgs10?.history?.length) {
    blocks.push({
      title: 'بازدهی اوراق ۱۰ساله آمریکا',
      color: '#7c2d12',
      series: fred.fred_dgs10.history.map((h) => ({ label: h.date.slice(5), value: h.value })),
    })
  }

  return (
    <section id="charts" className="scroll-mt-8 space-y-4">
      <div>
        <h2 className="section-title">نمودار قیمت‌های گزارش روزانه</h2>
        <p className="section-sub">
          تاریخچه زنده از TGJU و سری‌های کلان از FRED — مطابق اقلام گزارش اکسل/PDF
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {blocks.map((b) => (
          <div key={b.title} className="panel p-3">
            <h3 className="mb-1 text-sm font-bold text-[var(--color-brand)]">{b.title}</h3>
            {b.series.length ? (
              <PriceAreaChart data={b.series} color={b.color} height={180} />
            ) : (
              <div className="grid h-[180px] place-items-center text-xs text-[var(--color-muted)]">
                در حال دریافت تاریخچه…
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export function FredMacroSection({ fred }: { fred: Record<string, FredBundle> }) {
  const rows = Object.values(fred)
  return (
    <section id="macro" className="scroll-mt-8 space-y-4">
      <div>
        <h2 className="section-title">شاخص‌های کلان — FRED</h2>
        <p className="section-sub">جایگزین Trading Economics · منبع: بانک فدرال رزرو سنت‌لوئیس</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.length === 0 && (
          <div className="panel p-4 text-sm text-[var(--color-muted)] md:col-span-2">
            داده FRED روی دیپلوی Cloudflare از مسیر api فعال می‌شود. در حالت محلی اگر خالی بود، پس از
            دیپلوی دوباره تازه‌سازی کنید.
          </div>
        )}
        {rows.map((r) => (
          <div key={r.id} className="panel p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">{r.label}</h3>
              <span className="chip chip-live">FRED</span>
            </div>
            <div className="kpi-value num text-[1.35rem]">{r.last == null ? '—' : r.last.toLocaleString('en-US')}</div>
            <PriceAreaChart
              data={r.history.map((h) => ({ label: h.date.slice(5), value: h.value }))}
              color="#0b3d6e"
              height={160}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
