import { motion } from 'framer-motion'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DashboardData } from '../data/types'
import { changeClass, fmtChange, fmtInt, fmtNum, fmtPct } from '../lib/format'
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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="panel p-4"
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">
        {value}
        {unit ? <span className="mr-1 text-sm font-medium text-[var(--color-muted)]">{unit}</span> : null}
      </div>
      {changePct !== undefined && (
        <div className={`mt-2 text-sm font-semibold num ${changeClass(changePct)}`}>
          {fmtPct(changePct)}
          {change !== undefined ? <span className="mr-2 text-xs opacity-80">({fmtChange(change)})</span> : null}
        </div>
      )}
    </motion.div>
  )
}

const tipStyle = {
  background: '#15202b',
  border: 'none',
  borderRadius: 10,
  color: '#fff',
  fontSize: 12,
  fontFamily: 'Vazirmatn, sans-serif',
}

export function MarketOverview({ data }: { data: DashboardData }) {
  const o = data.overview
  const money = o.moneyFlowSeries.map((d) => ({
    ...d,
    fill: d.value >= 0 ? '#1f7a4d' : '#b42318',
  }))

  return (
    <section id="overview" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">خلاصه وقایع بورس و اوراق بهادار تهران</h2>
        <p className="section-sub">شاخص‌ها، ارزش بازار و جریان پول حقیقی — {o.dateJalali}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={o.tedpix.name}
          value={fmtInt(o.tedpix.value)}
          change={o.tedpix.change}
          changePct={o.tedpix.changePct}
          delay={0.05}
        />
        <Kpi
          label={o.equalWeight.name}
          value={fmtInt(o.equalWeight.value)}
          change={o.equalWeight.change}
          changePct={o.equalWeight.changePct}
          delay={0.1}
        />
        <Kpi
          label={o.ifb.name}
          value={fmtInt(o.ifb.value)}
          change={o.ifb.change}
          changePct={o.ifb.changePct}
          delay={0.15}
        />
        <Kpi
          label="مجموع ارزش بازار بورس و فرابورس"
          value={fmtInt(o.totalMarketValueHmt)}
          unit="همت"
          delay={0.2}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="ارزش دلاری بازار" value={fmtInt(o.totalMarketValueUsdM)} unit="میلیون $" delay={0.22} />
        <Kpi label="نرخ دلار (مرجع گزارش)" value={fmtInt(o.usdRate)} unit="ریال" delay={0.24} />
        <Kpi label="ارزش کل معاملات" value={fmtNum(o.totalTradeValueHmt, 1)} unit="همت" delay={0.26} />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="panel p-4"
        >
          <div className="kpi-label">خالص ورود پول حقیقی از ابتدای ۱۴۰۴</div>
          <div className={`kpi-value num ${changeClass(o.retailMoneyFlowYtd)}`}>
            {fmtInt(o.retailMoneyFlowYtd)}
            <span className="mr-1 text-sm font-medium text-[var(--color-muted)]">میلیارد تومان</span>
          </div>
        </motion.div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="panel p-4"
        >
          <h3 className="mb-3 text-sm font-bold">روند شاخص کل در روز جاری</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={o.intradayIndex}>
                <defs>
                  <linearGradient id="idxFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c87941" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#c87941" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#d4cfc4" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7c8a' }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={['dataMin - 5000', 'dataMax + 5000']}
                  tick={{ fontSize: 11, fill: '#6b7c8a' }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tickFormatter={(v: number) => (v / 1000).toFixed(0) + 'k'}
                />
                <Tooltip
                  contentStyle={tipStyle}
                  formatter={(v) => [fmtInt(Number(v)), 'شاخص']}
                />
                <Area type="monotone" dataKey="value" stroke="#b86b2e" strokeWidth={2.4} fill="url(#idxFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="panel p-4"
        >
          <h3 className="mb-3 text-sm font-bold">خالص ورود (خروج) پول حقیقی — میلیارد تومان</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={money}>
                <CartesianGrid stroke="#d4cfc4" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7c8a' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7c8a' }} axisLine={false} tickLine={false} width={48} />
                <Tooltip contentStyle={tipStyle} formatter={(v) => [fmtInt(Number(v)), 'میلیارد تومان']} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {money.map((d) => (
                    <Cell key={d.date} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ImpactPanel title="بیشترین تاثیر مثبت و منفی در بورس" pos={data.impacts.boursePos} neg={data.impacts.bourseNeg} />
        <ImpactPanel title="بیشترین تاثیر مثبت و منفی در فرابورس" pos={data.impacts.ifbPos} neg={data.impacts.ifbNeg} />
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
