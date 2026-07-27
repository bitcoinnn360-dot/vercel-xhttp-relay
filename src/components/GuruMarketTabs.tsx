import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { DashboardData } from '../data/types'
import type { FredBundle, HistoryPoint } from '../data/fetchers'
import { changeClass, fmtNum, fmtPct } from '../lib/format'
import { FlowBarChart, PriceAreaChart } from './charts/Charts'

type TabId = 'iran' | 'commodities' | 'steel' | 'macro' | 'portfolio'

const TABS: { id: TabId; label: string }[] = [
  { id: 'iran', label: 'بازار ایران' },
  { id: 'commodities', label: 'کامودیتی' },
  { id: 'steel', label: 'فولاد و سنگ‌آهن' },
  { id: 'macro', label: 'کلان جهانی' },
  { id: 'portfolio', label: 'پرتفو' },
]

function toSeries(points?: HistoryPoint[], slice = 80) {
  return (points || []).slice(-slice).map((p) => ({
    label: (p.dateJalali || p.date || '').slice(5),
    value: p.value,
  }))
}

function ChartCard({
  title,
  series,
  color,
}: {
  title: string
  series: { label: string; value: number }[]
  color: string
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[var(--color-line)] bg-[#f8fafc] px-3 py-2 text-xs font-bold text-[var(--color-brand)]">
        {title}
      </div>
      <div className="p-2">
        {series.length ? (
          <PriceAreaChart data={series} color={color} height={170} />
        ) : (
          <div className="grid h-[170px] place-items-center text-xs text-[var(--color-muted)]">بدون داده</div>
        )}
      </div>
    </div>
  )
}

function HeatCell({ label, pct }: { label: string; pct: number }) {
  const intensity = Math.min(Math.abs(pct) / 8, 1)
  const bg =
    pct >= 0
      ? `rgba(21, 128, 61, ${0.12 + intensity * 0.55})`
      : `rgba(185, 28, 28, ${0.12 + intensity * 0.55})`
  return (
    <div className="rounded-md border border-[var(--color-line)] px-2 py-3 text-center" style={{ background: bg }}>
      <div className="text-[0.7rem] font-semibold text-[var(--color-ink-soft)]">{label}</div>
      <div className={`mt-1 text-sm font-bold num ${changeClass(pct)}`}>{fmtPct(pct)}</div>
    </div>
  )
}

export function GuruMarketTabs({
  data,
  histories,
  fred,
  sectors,
}: {
  data: DashboardData
  histories: Record<string, HistoryPoint[]>
  fred: Record<string, FredBundle>
  sectors: { name: string; color: string; count: number; avgChangePct: number; members: string[] }[]
}) {
  const [tab, setTab] = useState<TabId>('iran')

  const groupPerf = useMemo(() => {
    const groups = ['سرمایه‌گذاری', 'سنگ‌آهن', 'فولادی', 'مس', 'کابل']
    return groups.map((g) => {
      const rows = data.stocks.filter((s) => s.group === g && !s.isIndustry)
      const avg = rows.length ? rows.reduce((a, b) => a + b.dailyPct, 0) / rows.length : 0
      return { name: g, avg, count: rows.length }
    })
  }, [data.stocks])

  const weighting = useMemo(
    () =>
      (sectors.length
        ? sectors
        : groupPerf.map((g, i) => ({
            name: g.name,
            color: ['#0b3d6e', '#b45309', '#0e7490', '#334155', '#c2410c'][i % 5],
            count: g.count,
            avgChangePct: g.avg,
            members: [],
          }))
      ).map((s) => ({ name: s.name, value: Math.max(s.count, 1), fill: s.color, avg: s.avgChangePct })),
    [sectors, groupPerf],
  )

  return (
    <section id="market-asia" className="scroll-mt-8 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="section-title">مرکز بازارها</h2>
          <p className="section-sub">دسته‌بندی شبیه تب Market در GuruFocus — نمودار، وزن بخش‌ها، مقایسه عملکرد</p>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-[var(--color-line)] bg-[#0b3d6e] px-2 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                tab === t.id ? 'bg-white text-[var(--color-brand)]' : 'text-slate-200 hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-4 p-3 sm:p-4">
          {tab === 'iran' && (
            <>
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="panel p-3 lg:col-span-1">
                  <h3 className="mb-2 text-xs font-bold text-[var(--color-muted)]">وزن بخش‌های قابل رصد</h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={weighting} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72}>
                          {weighting.map((w) => (
                            <Cell key={w.name} fill={w.fill} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: '#0f2744', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11 }}
                          itemStyle={{ color: '#fff' }}
                          labelStyle={{ color: '#fff' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="panel p-3 lg:col-span-2">
                  <h3 className="mb-2 text-xs font-bold text-[var(--color-muted)]">هیت‌مپ بازدهی روزانه گروه‌های معدنی</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                    {groupPerf.map((g) => (
                      <HeatCell key={g.name} label={g.name} pct={g.avg} />
                    ))}
                  </div>
                  <div className="mt-3">
                    <FlowBarChart
                      data={data.overview.moneyFlowSeries.slice(-18).map((d) => ({ label: d.date, value: d.value }))}
                      height={180}
                    />
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <ChartCard title="شاخص کل بورس" series={toSeries(histories.bourse)} color="#0b3d6e" />
                <ChartCard title="دلار آزاد" series={toSeries(histories.price_dollar_rl)} color="#0e7490" />
                <ChartCard title="سکه بهار آزادی" series={toSeries(histories.sekee)} color="#a16207" />
              </div>
            </>
          )}

          {tab === 'commodities' && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <ChartCard title="انس طلا" series={toSeries(histories.ons)} color="#b45309" />
              <ChartCard title="مس جهانی" series={toSeries(histories.copper)} color="#c2410c" />
              <ChartCard title="آلومینیوم" series={toSeries(histories.aluminium)} color="#475569" />
              <ChartCard title="روی" series={toSeries(histories.zinc)} color="#64748b" />
              <ChartCard title="نفت برنت" series={toSeries(histories.oil_brent)} color="#1e3a5f" />
              <ChartCard title="بیت‌کوین" series={toSeries(histories['crypto-bitcoin'])} color="#ea580c" />
              <div className="panel p-3 md:col-span-2 xl:col-span-3">
                <h3 className="mb-2 text-xs font-bold text-[var(--color-muted)]">مقایسه تغییر روزانه کامودیتی‌ها</h3>
                <FlowBarChart
                  data={data.commodities
                    .filter((c) => !['fmeli_cathode', 'iralco', 'calimin'].includes(c.id))
                    .map((c) => ({ label: c.name.slice(0, 10), value: c.changePct }))}
                  height={200}
                />
              </div>
            </div>
          )}

          {tab === 'steel' && (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {data.steel.slice(0, 8).map((s) => (
                  <HeatCell key={s.id} label={s.nameFa} pct={s.changePct} />
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <ChartCard title="سنگ‌آهن (جایگزین Custeel)" series={toSeries(histories['base-us-iron-ore'])} color="#334155" />
                <ChartCard title="ورق گرم آمریکا" series={toSeries(histories['base-us-steel-coil'])} color="#1a5f9e" />
                <ChartCard
                  title="سنگ‌آهن FRED"
                  series={(fred.fred_iron_ore?.history || []).map((h) => ({ label: h.date.slice(2, 7), value: h.value }))}
                  color="#0f766e"
                />
                <div className="panel p-3 md:col-span-2 xl:col-span-3">
                  <h3 className="mb-2 text-xs font-bold text-[var(--color-muted)]">ضریب زنجیره بورس کالا نسبت به شمش</h3>
                  <FlowBarChart
                    data={data.imeChain.map((r) => ({
                      label: r.product.replace(' (مبارکه)', '').replace(' (میانگین شمش)', '').slice(0, 12),
                      value: r.ratioToBilletPct,
                    }))}
                    height={210}
                  />
                </div>
              </div>
            </>
          )}

          {tab === 'macro' && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Object.values(fred).map((r) => (
                <ChartCard
                  key={r.id}
                  title={r.label}
                  series={r.history.map((h) => ({ label: h.date.slice(5), value: h.value }))}
                  color="#0b3d6e"
                />
              ))}
              {!Object.keys(fred).length && (
                <div className="panel p-4 text-sm text-[var(--color-muted)]">داده FRED هنوز لود نشده.</div>
              )}
              <div className="panel overflow-x-auto p-2 md:col-span-2 xl:col-span-3">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>شاخص</th>
                      <th>مقدار</th>
                      <th>تغییر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.periodic
                      .filter((p) => p.group === 'macro')
                      .map((p) => (
                        <tr key={p.name}>
                          <td className="font-semibold">{p.name}</td>
                          <td className="num">{fmtNum(p.price, 2)}</td>
                          <td className={`num ${changeClass(p.dailyPct ?? p.weeklyPct)}`}>
                            {fmtPct(p.dailyPct ?? p.weeklyPct)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'portfolio' && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="panel p-3">
                <h3 className="mb-2 text-xs font-bold text-[var(--color-muted)]">ترکیب پرتفو</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.holdings.map((h) => ({ name: h.symbol, value: h.portfolioPct }))}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={78}
                      >
                        {data.holdings.map((h, i) => (
                          <Cell key={h.symbol} fill={['#0b3d6e', '#1a5f9e', '#0e7490', '#b45309', '#334155', '#c2410c'][i % 6]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#0f2744', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11 }}
                        itemStyle={{ color: '#fff' }}
                        labelStyle={{ color: '#fff' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="panel p-3">
                <h3 className="mb-2 text-xs font-bold text-[var(--color-muted)]">ارزش افزوده نمادها</h3>
                <FlowBarChart
                  data={data.holdings.map((h) => ({ label: h.symbol, value: Math.round(h.unrealizedMr / 1e6) }))}
                  height={220}
                />
                <p className="mt-1 text-[0.65rem] text-[var(--color-muted)]">میلیون ریال / مقیاس خلاصه</p>
              </div>
              <div className="panel grid grid-cols-2 gap-3 p-4 md:col-span-2">
                <div>
                  <div className="kpi-label">NAV هر سهم</div>
                  <div className="kpi-value num">{fmtNum(data.nav.navPerShare, 0)}</div>
                </div>
                <div>
                  <div className="kpi-label">P / NAV</div>
                  <div className="kpi-value num">{fmtNum(data.nav.pNavPct, 1)}٪</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
