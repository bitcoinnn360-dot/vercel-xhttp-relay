import { motion } from 'framer-motion'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { DashboardData } from '../data/types'
import { changeClass, fmtInt, fmtNum, fmtPct } from '../lib/format'

const COLORS = ['#b86b2e', '#2f5d7a', '#1f7a4d', '#8f4e1c', '#4a7a96', '#c87941', '#3d4f5f', '#6b7c8a', '#15202b', '#7a5c3a', '#2a6f6f', '#8a3a4a']
const RADIAN = Math.PI / 180

type PieLabelProps = {
  cx?: number
  cy?: number
  midAngle?: number
  outerRadius?: number
  name?: string
  percent?: number
  index?: number
}

/** Excel-style callout: thin leader line from slice → symbol name. */
function PieCalloutLabel({ cx = 0, cy = 0, midAngle = 0, outerRadius = 0, name = '', percent = 0, index = 0 }: PieLabelProps) {
  if (!name || percent < 0.008) return null
  const cos = Math.cos(-midAngle * RADIAN)
  const sin = Math.sin(-midAngle * RADIAN)
  const sx = cx + (outerRadius + 2) * cos
  const sy = cy + (outerRadius + 2) * sin
  const mx = cx + (outerRadius + 14) * cos
  const my = cy + (outerRadius + 14) * sin
  const ex = mx + (cos >= 0 ? 12 : -12)
  const ey = my
  const anchor = cos >= 0 ? 'start' : 'end'
  const color = COLORS[index % COLORS.length]
  return (
    <g>
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={color} strokeWidth={1} fill="none" opacity={0.75} />
      <circle cx={ex} cy={ey} r={1.5} fill={color} />
      <text
        x={ex + (cos >= 0 ? 4 : -4)}
        y={ey}
        textAnchor={anchor}
        dominantBaseline="central"
        className="fill-[var(--color-ink)]"
        style={{ fontSize: 11, fontWeight: 700 }}
      >
        {name}
      </text>
    </g>
  )
}

export function NavSection({ data }: { data: DashboardData }) {
  const { nav, holdings } = data
  const pie = holdings
    .filter((h) => h.portfolioPct > 0.05)
    .map((h) => ({
      name: h.symbol,
      value: h.portfolioPct,
    }))
  const navDelta = nav.navPerShare - nav.prev.navPerShare
  const navDeltaPct = (navDelta / nav.prev.navPerShare) * 100
  const liveCount = holdings.filter((h) => h.live).length
  const totalCost = holdings.reduce((s, h) => s + (h.costMr || 0), 0)
  const totalMv = holdings.reduce((s, h) => s + (h.marketValueMr || 0), 0)
  const totalUnreal = holdings.reduce((s, h) => s + (h.unrealizedMr || 0), 0)

  return (
    <section id="nav" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">ارزش روز خالص دارایی‌های بورسی (NAV)</h2>
        <p className="section-sub">
          پرتفوی شرکت سرمایه‌گذاری توسعه معادن و فلزات
          {liveCount
            ? ` · قیمت و تعداد سهام از بورس‌ویو (${liveCount} نماد) · بهای تمام‌شده از گزارش روزانه`
            : ' · در انتظار داده زنده بورس‌ویو'}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="panel relative overflow-hidden p-5 lg:col-span-1"
        >
          <div
            className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full opacity-30"
            style={{ background: 'radial-gradient(circle, #c87941, transparent 70%)' }}
          />
          <div className="kpi-label">NAV هر سهم</div>
          <div className="kpi-value num text-[var(--color-copper-deep)]">{fmtInt(nav.navPerShare)}</div>
          <div className={`mt-2 text-sm font-semibold num ${changeClass(navDeltaPct)}`}>
            {fmtPct(navDeltaPct)} نسبت به روز گذشته ({fmtInt(nav.prev.navPerShare)})
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="kpi-label">قیمت روز سهم</div>
              <div className="mt-1 text-lg font-bold num">{fmtInt(nav.sharePrice)}</div>
            </div>
            <div>
              <div className="kpi-label">P / NAV</div>
              <div className="mt-1 text-lg font-bold num">{fmtNum(nav.pNavPct, 1)}٪</div>
            </div>
            <div>
              <div className="kpi-label">خالص ارزش روز دارایی‌ها</div>
              <div className="mt-1 font-bold num">{fmtInt(nav.navMr)}</div>
            </div>
            <div>
              <div className="kpi-label">آخرین سرمایه</div>
              <div className="mt-1 font-bold num">{fmtInt(nav.capitalMr)}</div>
            </div>
          </div>
        </motion.div>

        <div className="panel p-4 lg:col-span-1">
          <h3 className="mb-2 text-sm font-bold">ترکیب پرتفو (درصد از پورتفو)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 8, right: 28, bottom: 8, left: 28 }}>
                <Pie
                  data={pie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={2}
                  label={PieCalloutLabel}
                  labelLine={false}
                  isAnimationActive={false}
                >
                  {pie.map((entry, i) => (
                    <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#15202b',
                    border: 'none',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 12,
                  }}
                  itemStyle={{ color: '#fff' }}
                  labelStyle={{ color: '#fff' }}
                  formatter={(v) => [`${fmtNum(Number(v), 1)}٪`, 'سهم از پرتفو']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel space-y-3 p-4">
          <h3 className="text-sm font-bold">اجزای محاسبه NAV (میلیون ریال)</h3>
          <NavRow label="ارزش افزوده روز پرتفوی بورسی" value={nav.listedPremiumMr} prev={nav.prev.listedPremiumMr} />
          <NavRow label="ارزش افزوده پرتفوی غیربورسی" value={nav.unlistedPremiumMr} />
          <NavRow label="ذخیره کاهش ارزش سرمایه‌گذاری‌ها" value={nav.impairmentReserveMr} />
          <NavRow label="ارزش افزوده املاک" value={nav.realEstatePremiumMr} />
          <NavRow label="حقوق صاحبان سهام" value={nav.equityMr} />
        </div>
      </div>

      <div className="panel overflow-x-auto p-2 sm:p-3">
        <table className="data-table min-w-[1100px]">
          <thead>
            <tr>
              <th>نماد</th>
              <th>
                سرمایه
                <div className="unit-row">میلیون ریال</div>
              </th>
              <th>درصد مالکیت</th>
              <th>درصد از پورتفو</th>
              <th>
                بهای تمام‌شده
                <div className="unit-row">میلیون ریال</div>
              </th>
              <th>
                ارزش بازار
                <div className="unit-row">میلیون ریال</div>
              </th>
              <th>
                بهای هر سهم
                <div className="unit-row">ریال</div>
              </th>
              <th>
                ارزش هر سهم
                <div className="unit-row">ریال</div>
              </th>
              <th>
                ارزش افزوده
                <div className="unit-row">میلیون ریال</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.symbol} className={h.static ? 'totals' : undefined}>
                <td className="font-bold">{h.symbol}</td>
                <td className="num">{h.capitalMr ? fmtInt(h.capitalMr) : '—'}</td>
                <td className="num">{h.ownershipPct ? fmtNum(h.ownershipPct, 2) : '—'}</td>
                <td className="num">{fmtNum(h.portfolioPct, 1)}</td>
                <td className="num">{fmtInt(h.costMr)}</td>
                <td className="num">{fmtInt(h.marketValueMr)}</td>
                <td className="num">{h.costPerShare ? fmtInt(h.costPerShare) : '—'}</td>
                <td className="num">{h.pricePerShare ? fmtInt(h.pricePerShare) : '—'}</td>
                <td className={`num font-semibold ${changeClass(h.unrealizedMr)}`}>{fmtInt(h.unrealizedMr)}</td>
              </tr>
            ))}
            <tr className="totals">
              <td className="font-bold">جمع</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num">۱۰۰</td>
              <td className="num font-bold">{fmtInt(totalCost)}</td>
              <td className="num font-bold">{fmtInt(totalMv)}</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className={`num font-bold ${changeClass(totalUnreal)}`}>{fmtInt(totalUnreal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function NavRow({ label, value, prev }: { label: string; value: number; prev?: number }) {
  const delta = prev !== undefined ? value - prev : undefined
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)]/70 pb-2 last:border-0">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <div className="text-left">
        <div className="text-sm font-bold num">{fmtInt(value)}</div>
        {delta !== undefined && (
          <div className={`text-[0.7rem] num ${changeClass(delta)}`}>{fmtPct((delta / (prev || 1)) * 100)}</div>
        )}
      </div>
    </div>
  )
}
