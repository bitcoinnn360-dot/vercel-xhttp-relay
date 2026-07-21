import { motion } from 'framer-motion'
import type { DashboardData } from '../data/types'
import type { HistoryPoint } from '../data/fetchers'
import { changeClass, fmtChange, fmtInt, fmtNum, fmtPct } from '../lib/format'
import { FlowBarChart, PriceAreaChart } from './charts/Charts'
import { TopTrades } from './StocksSection'

function Kpi({
  label,
  value,
  unit,
  change,
  changePct,
  delay = 0,
}: {
  label: string
  value: string
  unit?: string
  change?: number
  changePct?: number
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className="panel p-3.5"
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">
        {value}
        {unit ? <span className="mr-1 text-xs font-medium text-[var(--color-muted)]">{unit}</span> : null}
      </div>
      {changePct !== undefined && (
        <div className={`mt-1.5 text-sm font-semibold num ${changeClass(changePct)}`}>
          {fmtPct(changePct)}
          {change !== undefined ? <span className="mr-2 text-xs opacity-80">({fmtChange(change)})</span> : null}
        </div>
      )}
    </motion.div>
  )
}

export function MarketOverview({
  data,
  histories,
}: {
  data: DashboardData
  histories: Record<string, HistoryPoint[]>
}) {
  const o = data.overview
  const money = o.moneyFlowSeries.map((d) => ({ label: d.date, value: d.value }))
  const indexSeries = (histories.bourse || []).slice(-60).map((p) => ({
    label: (p.dateJalali || p.date).slice(5),
    value: p.value,
  }))

  return (
    <section id="overview" className="scroll-mt-8 space-y-4">
      <div>
        <h2 className="section-title">خلاصه بازار سرمایه ایران</h2>
        <p className="section-sub">شاخص کل زنده از TGJU · جزئیات گزارش روزانه</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={o.tedpix.name} value={fmtInt(o.tedpix.value)} change={o.tedpix.change} changePct={o.tedpix.changePct} delay={0.02} />
        <Kpi label={o.equalWeight.name} value={fmtInt(o.equalWeight.value)} change={o.equalWeight.change} changePct={o.equalWeight.changePct} delay={0.05} />
        <Kpi label={o.ifb.name} value={fmtInt(o.ifb.value)} change={o.ifb.change} changePct={o.ifb.changePct} delay={0.08} />
        <Kpi label="مجموع ارزش بازار" value={fmtInt(o.totalMarketValueHmt)} unit="همت" delay={0.1} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="ارزش دلاری بازار" value={fmtInt(o.totalMarketValueUsdM)} unit="میلیون $" />
        <Kpi label="نرخ دلار" value={fmtInt(o.usdRate)} unit="ریال" />
        <Kpi label="ارزش کل معاملات" value={fmtNum(o.totalTradeValueHmt, 1)} unit="همت" />
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel p-3.5">
          <div className="kpi-label">خالص ورود پول حقیقی از ابتدای ۱۴۰۴</div>
          <div className={`kpi-value num ${changeClass(o.retailMoneyFlowYtd)}`}>
            {fmtInt(o.retailMoneyFlowYtd)}
            <span className="mr-1 text-xs font-medium text-[var(--color-muted)]">میلیارد تومان</span>
          </div>
        </motion.div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-bold">روند شاخص کل (تاریخچه TGJU)</h3>
          <PriceAreaChart data={indexSeries.length ? indexSeries : o.intradayIndex.map((x) => ({ label: x.time, value: x.value }))} color="#0b3d6e" />
        </div>
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-bold">خالص ورود/خروج پول حقیقی</h3>
          <FlowBarChart data={money} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ImpactPanel title="تأثیر مثبت/منفی بورس" pos={data.impacts.boursePos} neg={data.impacts.bourseNeg} />
        <ImpactPanel title="تأثیر مثبت/منفی فرابورس" pos={data.impacts.ifbPos} neg={data.impacts.ifbNeg} />
        <TopTrades data={data} />
      </div>
    </section>
  )
}

function ImpactPanel({
  title,
  pos,
  neg,
}: {
  title: string
  pos: { symbol: string; impact: number }[]
  neg: { symbol: string; impact: number }[]
}) {
  return (
    <div className="panel p-4">
      <h3 className="mb-3 text-sm font-bold">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        <ul className="space-y-2">
          {pos.map((s) => (
            <li key={s.symbol} className="flex items-center justify-between text-sm">
              <span className="font-semibold">{s.symbol}</span>
              <span className="num pos">{fmtChange(s.impact)}</span>
            </li>
          ))}
        </ul>
        <ul className="space-y-2">
          {neg.map((s) => (
            <li key={s.symbol} className="flex items-center justify-between text-sm">
              <span className="font-semibold">{s.symbol}</span>
              <span className="num neg">{fmtChange(s.impact)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
