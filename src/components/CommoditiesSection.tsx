import { motion } from 'framer-motion'
import type { CommodityQuote, DashboardData } from '../data/types'
import { changeClass, fmtNum, fmtPct } from '../lib/format'
import { Sparkline } from './charts/Charts'

export function CommoditiesSection({ data }: { data: DashboardData }) {
  return (
    <section id="commodities" className="scroll-mt-8 space-y-4">
      <div>
        <h2 className="section-title">کامودیتی و ارز</h2>
        <p className="section-sub">زنده از TGJU · اسپارک‌لاین تاریخچه قیمت</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.commodities.map((c, i) => (
          <CommodityCard key={c.id} c={c} delay={i * 0.03} />
        ))}
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
