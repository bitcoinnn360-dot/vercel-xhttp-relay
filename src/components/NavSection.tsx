import { motion } from 'framer-motion'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { DashboardData } from '../data/types'
import { changeClass, fmtInt, fmtNum, fmtPct } from '../lib/format'

const COLORS = ['#b86b2e', '#2f5d7a', '#1f7a4d', '#8f4e1c', '#4a7a96', '#c87941', '#3d4f5f', '#6b7c8a', '#15202b']

export function NavSection({ data }: { data: DashboardData }) {
  const { nav, holdings } = data
  const pie = holdings.map((h) => ({
    name: h.symbol,
    value: h.portfolioPct,
  }))
  const navDelta = nav.navPerShare - nav.prev.navPerShare
  const navDeltaPct = (navDelta / nav.prev.navPerShare) * 100

  return (
    <section id="nav" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">ارزش روز خالص دارایی‌های بورسی (NAV)</h2>
        <p className="section-sub">پرتفوی شرکت سرمایه‌گذاری توسعه معادن و فلزات</p>
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
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2}>
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
          <div className="flex flex-wrap justify-center gap-2">
            {pie.slice(0, 6).map((p, i) => (
              <span key={p.name} className="inline-flex items-center gap-1 text-[0.7rem] text-[var(--color-muted)]">
                <i className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                {p.name}
              </span>
            ))}
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
        <table className="data-table min-w-[900px]">
          <thead>
            <tr>
              <th>نماد</th>
              <th>درصد مالکیت</th>
              <th>درصد از پورتفو</th>
              <th>بهای تمام‌شده</th>
              <th>ارزش بازار</th>
              <th>بهای هر سهم</th>
              <th>ارزش هر سهم</th>
              <th>ارزش افزوده</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.symbol}>
                <td className="font-bold">{h.symbol}</td>
                <td className="num">{fmtNum(h.ownershipPct, 2)}</td>
                <td className="num">{fmtNum(h.portfolioPct, 1)}</td>
                <td className="num">{fmtInt(h.costMr)}</td>
                <td className="num">{fmtInt(h.marketValueMr)}</td>
                <td className="num">{fmtInt(h.costPerShare)}</td>
                <td className="num">{fmtInt(h.pricePerShare)}</td>
                <td className="num pos font-semibold">{fmtInt(h.unrealizedMr)}</td>
              </tr>
            ))}
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
