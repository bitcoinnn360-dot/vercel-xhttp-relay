import { motion } from 'framer-motion'
import type { HistoryPoint } from '../data/fetchers'
import type { CandlePoint, CommodityQuote, DashboardData } from '../data/types'
import { changeClass, fmtNum, fmtPct } from '../lib/format'
import { CandlestickChart, PriceAreaChart, Sparkline } from './charts/Charts'

/** TGJU keys that have OHLC history — shown as candlesticks under the quotes. */
const CANDLE_BLOCKS: { key: string; title: string }[] = [
  { key: 'bourse', title: 'شاخص کل بورس' },
  { key: 'ons', title: 'انس طلا' },
  { key: 'price_dollar_rl', title: 'دلار آزاد' },
  { key: 'sekee', title: 'سکه بهار آزادی' },
  { key: 'copper', title: 'مس جهانی' },
  { key: 'aluminium', title: 'آلومینیوم' },
  { key: 'zinc', title: 'روی جهانی' },
  { key: 'oil_brent', title: 'نفت برنت' },
  { key: 'crypto-bitcoin', title: 'بیت‌کوین' },
  { key: 'base-us-iron-ore', title: 'سنگ‌آهن (مرجع TGJU)' },
  { key: 'base-us-steel-coil', title: 'ورق گرم آمریکا' },
  { key: 'energy-natural-gas', title: 'گاز طبیعی' },
]

function toSeries(points?: HistoryPoint[]) {
  return (points || []).map((p) => ({
    label: (p.dateJalali || p.date || '').slice(5),
    value: p.value,
  }))
}

export function CommoditiesSection({
  data,
  histories,
  candles,
}: {
  data: DashboardData
  histories?: Record<string, HistoryPoint[]>
  candles?: Record<string, CandlePoint[]>
}) {
  return (
    <section id="commodities" className="scroll-mt-28 space-y-5">
      <div>
        <h2 className="section-title">کامودیتی و ارز</h2>
        <p className="section-sub">قیمت لحظه‌ای TGJU · رشد روزانه · نمودار کندل از ۲۰۲۲</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.commodities.map((c, i) => (
          <CommodityCard key={c.id} c={c} delay={i * 0.03} />
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-extrabold text-[var(--color-brand)]">نمودارهای کندلی</h3>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          OHLC هفتگی از TGJU — در صورت نبود کندل، نمودار خطی تاریخچه نمایش داده می‌شود
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CANDLE_BLOCKS.map((b, i) => {
            const ohlc = candles?.[b.key] || []
            const fallback = toSeries(histories?.[b.key])
            return (
              <motion.div
                key={b.key}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: Math.min(i * 0.02, 0.2) }}
                className="panel p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-[var(--color-brand)]">{b.title}</h4>
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
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function CommodityCard({ c, delay }: { c: CommodityQuote; delay: number }) {
  const spark = (c.history || []).map((h) => ({ v: h.v }))
  const up = c.changePct >= 0
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.35 }}
      className="panel p-3.5"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold leading-snug">{c.name}</h3>
        <span className={`chip ${c.source === 'tgju' ? 'chip-live' : 'chip-seed'}`}>
          {c.source === 'tgju' ? 'زنده' : 'گزارش'}
        </span>
      </div>
      <div className="mt-2 kpi-value num text-[1.35rem]">{fmtNum(c.value, c.value >= 1000 ? 0 : 2)}</div>
      <div className="text-xs text-[var(--color-muted)]">{c.unit}</div>
      <div className={`mt-2 text-sm font-semibold num ${changeClass(c.changePct)}`}>{fmtPct(c.changePct)}</div>
      <div className="mt-2">
        <Sparkline data={spark} color={up ? '#15803d' : '#b91c1c'} />
      </div>
    </motion.article>
  )
}
