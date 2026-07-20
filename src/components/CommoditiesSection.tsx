import { motion } from 'framer-motion'
import type { CommodityQuote, DashboardData } from '../data/types'
import { changeClass, fmtNum, fmtPct } from '../lib/format'

export function CommoditiesSection({ data }: { data: DashboardData }) {
  return (
    <section id="commodities" className="scroll-mt-28 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="section-title">آخرین نرخ کامودیتی‌ها</h2>
          <p className="section-sub">اتصال زنده به TGJU برای طلا، ارز، مس، آلومینیوم، نفت و بیت‌کوین</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.commodities.map((c, i) => (
          <CommodityCard key={c.id} c={c} delay={i * 0.04} />
        ))}
      </div>
    </section>
  )
}

function CommodityCard({ c, delay }: { c: CommodityQuote; delay: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay, duration: 0.4 }}
      className="panel group relative overflow-hidden p-4"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 origin-right scale-x-0 bg-gradient-to-l from-[var(--color-copper)] to-[var(--color-steel)] transition duration-500 group-hover:scale-x-100"
      />
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold leading-snug">{c.name}</h3>
        <span className={`chip text-[0.65rem] ${c.source === 'tgju' ? 'chip-live' : 'chip-seed'}`}>
          {c.source === 'tgju' ? 'زنده' : 'گزارش'}
        </span>
      </div>
      <div className="mt-3 kpi-value num text-[1.45rem]">
        {fmtNum(c.value, c.value >= 1000 ? 0 : 2)}
      </div>
      <div className="mt-1 text-xs text-[var(--color-muted)]">{c.unit}</div>
      <div className={`mt-3 text-sm font-semibold num ${changeClass(c.changePct)}`}>
        {fmtPct(c.changePct)}
        <span className="mr-2 text-xs opacity-75">({fmtNum(c.change, c.value >= 1000 ? 0 : 2)})</span>
      </div>
      {c.lastTradeJalali && (
        <div className="mt-2 text-[0.7rem] text-[var(--color-muted)]">آخرین معامله: {c.lastTradeJalali}</div>
      )}
    </motion.article>
  )
}
