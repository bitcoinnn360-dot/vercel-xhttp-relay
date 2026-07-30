import type { HistoryPoint } from '../data/fetchers'
import type { CandlePoint, DashboardData } from '../data/types'
import { CandlestickChart, PriceAreaChart } from './charts/Charts'

function toSeries(points?: HistoryPoint[]) {
  return (points || []).map((p) => ({
    label: (p.dateJalali || p.date || '').slice(5),
    value: p.value,
  }))
}

const TGJU_CANDLE_BLOCKS: { key: string; title: string }[] = [
  { key: 'bourse', title: 'شاخص کل بورس (TGJU)' },
  { key: 'ons', title: 'انس طلا' },
  { key: 'price_dollar_rl', title: 'دلار آزاد' },
  { key: 'sekee', title: 'سکه بهار آزادی' },
  { key: 'copper', title: 'مس جهانی' },
  { key: 'aluminium', title: 'آلومینیوم' },
  { key: 'zinc', title: 'روی جهانی' },
  { key: 'oil_brent', title: 'نفت برنت' },
  { key: 'crypto-bitcoin', title: 'بیت‌کوین' },
  { key: 'base-us-iron-ore', title: 'سنگ‌آهن (مرجع فرعی TGJU)' },
  { key: 'base-us-steel-coil', title: 'ورق گرم آمریکا' },
]

export function ChartsHub({
  histories,
  candles,
}: {
  data: DashboardData
  histories: Record<string, HistoryPoint[]>
  candles?: Record<string, CandlePoint[]>
}) {
  return (
    <section id="charts" className="scroll-mt-8 space-y-4">
      <div>
        <h2 className="section-title">نمودار کامودیتی‌ها</h2>
        <p className="section-sub">کندل OHLC از TGJU از ۲۰۲۲ تا امروز (هفتگی برای خوانایی)</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {TGJU_CANDLE_BLOCKS.map((b) => {
          const ohlc = candles?.[b.key] || []
          const fallback = toSeries(histories[b.key])
          return (
            <div key={b.key} className="panel p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-[var(--color-brand)]">{b.title}</h3>
                {ohlc.length ? (
                  <span className="chip chip-live text-[10px]">کندل · از ۲۰۲۲</span>
                ) : null}
              </div>
              {ohlc.length ? (
                <CandlestickChart data={ohlc} height={200} ariaLabel={`کندل ${b.title}`} />
              ) : fallback.length ? (
                <PriceAreaChart data={fallback} color="#0b3d6e" height={200} />
              ) : (
                <div className="grid h-[200px] place-items-center text-xs text-[var(--color-muted)]">
                  در حال دریافت تاریخچه…
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
