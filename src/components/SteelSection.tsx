import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DashboardData } from '../data/types'
import type { HistoryPoint } from '../data/fetchers'
import { changeClass, fmtInt, fmtNum, fmtPct } from '../lib/format'
import { PriceAreaChart, Sparkline } from './charts/Charts'

const CHART_IDS: { id: string; title: string; color: string }[] = [
  { id: 'pb61', title: 'نرمه PB ۶۱.۵٪ FOB', color: '#0b3d6e' },
  { id: 'br_pellet', title: 'گندله برزیل ۶۵٪ FOB', color: '#9a3412' },
  { id: 'tangshan_billet', title: 'بیلت تانگشان', color: '#0f766e' },
  { id: 'hr_shanghai', title: 'ورق گرم شانگهای', color: '#a16207' },
  { id: 'rebar_beijing', title: 'میلگرد پکن ۱۶ میل', color: '#7c2d12' },
  { id: 'seaborne62', title: 'شاخص دریایی CSI ۶۲٪', color: '#334155' },
]

export function SteelSection({
  data,
  histories,
}: {
  data: DashboardData
  histories?: Record<string, HistoryPoint[]>
}) {
  const chain = data.imeChain.map((r) => ({
    name: r.product.replace(' (مبارکه)', '').replace(' (میانگین شمش)', ''),
    ratio: r.ratioToBilletPct,
    price: r.priceRialKg,
  }))

  const billet = data.billetStocks
  const custeelLive = data.sources.find((s) => s.id === 'custeel')?.status === 'live'
  const imeLive = data.sources.find((s) => s.id === 'ime')?.status === 'live'

  const chartSeries = CHART_IDS.map((c) => {
    const fromHist = histories?.[`steel:${c.id}`] || histories?.[c.id]
    const fromRow = data.steel.find((s) => s.id === c.id)?.history
    const pts =
      fromHist?.map((p) => ({ label: p.dateJalali || p.date, value: p.value })) ||
      fromRow?.map((p) => ({ label: p.t, value: p.v })) ||
      []
    return { ...c, pts: pts.slice(-90) }
  }).filter((c) => c.pts.length > 2)

  return (
    <section id="steel" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">زنجیره فولاد — چین و ایران</h2>
        <p className="section-sub">
          {custeelLive ? 'Custeel زنده' : 'Custeel (seed)'}
          {' · '}
          {imeLive ? 'بورس کالا زنده (offer-stat)' : 'بورس کالا: در انتظار IP ایران / دیتای دستی'}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel p-4">
          <div className="kpi-label">{data.inventories.label}</div>
          <div className="kpi-value num text-[1.5rem]">{fmtInt(data.inventories.value)}</div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            هزار تن{data.inventories.asOf ? ` · آمار ${data.inventories.asOf}` : ''}
          </div>
          <div className={`mt-2 text-sm font-semibold num ${changeClass(data.inventories.wowChange)}`}>
            تغییر هفتگی: {fmtInt(data.inventories.wowChange)}
          </div>
        </div>
        <div className="panel p-4">
          <div className="kpi-label">نرخ بهره‌برداری کوره بلند تانگشان</div>
          <div className="kpi-value num text-[1.5rem]">{fmtNum(data.bfRate.rate, 2)}٪</div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            {data.bfRate.asOf ? `آمار ${data.bfRate.asOf} · تعداد کوره` : 'بر اساس تعداد کوره'}
          </div>
          <div className={`mt-2 text-sm font-semibold num ${changeClass(data.bfRate.wowChangePct)}`}>
            تغییر هفتگی: {fmtPct(data.bfRate.wowChangePct)}
          </div>
        </div>
        <div className="panel p-4">
          <div className="kpi-label">{billet?.label || 'موجودی بیلت تانگشان'}</div>
          <div className="kpi-value num text-[1.5rem]">{fmtInt(billet?.value ?? 0)}</div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">هزار تن</div>
          <div className={`mt-2 text-sm font-semibold num ${changeClass(billet?.wowChange ?? 0)}`}>
            تغییر هفتگی: {fmtInt(billet?.wowChange ?? 0)}
          </div>
        </div>
      </div>

      {chartSeries.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {chartSeries.map((c) => (
            <div key={c.id} className="panel p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-[var(--color-muted)]">{c.title}</h3>
                <span className="num text-sm font-semibold">{fmtNum(c.pts[c.pts.length - 1]?.value, 1)}</span>
              </div>
              <div className="h-36">
                <PriceAreaChart data={c.pts} color={c.color} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel overflow-x-auto p-2 sm:p-3">
          <h3 className="mb-2 px-2 pt-2 text-sm font-bold">آخرین نرخ زنجیره فولاد</h3>
          <table className="data-table min-w-[560px]">
            <thead>
              <tr>
                <th>محصول</th>
                <th>نرخ</th>
                <th>واحد</th>
                <th>تغییر</th>
                <th>روند</th>
                <th>منطقه</th>
              </tr>
            </thead>
            <tbody>
              {data.steel.map((s) => (
                <tr key={s.id}>
                  <td className="font-semibold">
                    {s.nameFa}
                    {s.asOf ? (
                      <span className="mt-0.5 block text-[0.65rem] font-normal text-[var(--color-muted)]">
                        {s.asOf}
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{fmtNum(s.value, 1)}</td>
                  <td className="text-[var(--color-muted)]">{s.unit}</td>
                  <td className={`num font-semibold ${changeClass(s.changePct)}`}>{fmtPct(s.changePct)}</td>
                  <td className="w-24">
                    {s.history?.length ? (
                      <Sparkline
                        data={s.history}
                        color={s.changePct >= 0 ? '#0f766e' : '#b45309'}
                        height={28}
                      />
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                  <td>
                    <span className="chip text-[0.65rem]">
                      {s.region === 'china' ? 'چین' : s.region === 'iran' ? 'ایران' : 'جهانی'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel p-4">
          <h3 className="mb-1 text-sm font-bold">ضریب قیمتی زنجیره فولاد بورس کالا نسبت به شمش</h3>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            {imeLive
              ? 'از آمار معاملات فیزیکی ime.co.ir/offer-stat'
              : 'فعلاً از seed — برای زنده شدن باید scrape از IP ایران اجرا شود'}
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chain} layout="vertical" margin={{ right: 16, left: 8 }}>
                <CartesianGrid stroke="#d4cfc4" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7c8a' }} unit="%" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={100}
                  tick={{ fontSize: 11, fill: '#3d4f5f' }}
                  axisLine={false}
                  tickLine={false}
                />
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
                  formatter={(v, _n, item) => {
                    const price = (item?.payload as { price?: number })?.price
                    return [
                      `${fmtNum(Number(v), 1)}٪${price ? ` · ${fmtInt(price)} ریال` : ''}`,
                      'نسبت به شمش',
                    ]
                  }}
                />
                <Bar dataKey="ratio" fill="#2f5d7a" radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="data-table mt-2">
            <thead>
              <tr>
                <th>محصول</th>
                <th>ریال/کیلو</th>
                <th>ضریب</th>
                <th>تاریخ</th>
              </tr>
            </thead>
            <tbody>
              {data.imeChain.map((r) => (
                <tr key={r.product}>
                  <td>{r.product}</td>
                  <td className="num">{fmtInt(r.priceRialKg)}</td>
                  <td className="num">{fmtNum(r.ratioToBilletPct, 1)}٪</td>
                  <td className="num text-[var(--color-muted)]">{r.tradeDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
