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

  const chinaBillet = data.steel.find((s) => s.id === 'tangshan_billet')
  const chinaRatioDefs: { id: string; name: string; key: string }[] = [
    { id: 'tangshan_billet', name: 'بیلت تانگشان', key: 'billet' },
    { id: 'rebar_beijing', name: 'میلگرد پکن', key: 'rebar' },
    { id: 'br_pellet', name: 'گندله برزیل (FOB)', key: 'pellet' },
    { id: 'chile_conc', name: 'کنسانتره شیلی (FOB)', key: 'conc' },
    { id: 'iran_conc', name: 'کنسانتره ایران (FOB)', key: 'iran_conc' },
    { id: 'pb61', name: 'نرمه سنگ‌آهن PB', key: 'ore' },
    { id: 'brbf', name: 'نرمه BRBF برزیل', key: 'brbf' },
    { id: 'iran_hem', name: 'هماتیت ایران (FOB)', key: 'hem' },
  ]
  const chinaChain =
    chinaBillet?.value && chinaBillet.value > 0
      ? chinaRatioDefs
          .map((d) => {
            const row = data.steel.find((s) => s.id === d.id)
            if (!row?.value) return null
            return {
              name: d.name,
              price: row.value,
              unit: row.unit,
              ratio: Math.round((row.value / chinaBillet.value) * 1000) / 10,
            }
          })
          .filter(Boolean) as { name: string; price: number; unit: string; ratio: number }[]
      : []

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

        <div className="panel p-4 lg:col-span-2">
          <h3 className="mb-1 text-sm font-bold">ضریب قیمتی زنجیره نسبت به شمش — ایران و چین</h3>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            ایران: بورس کالا (ریال) · چین/دریایی: Custeel نسبت به بیلت تانگشان (دلار) · اسفنجی فعلاً فقط در ایران
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <RatioBlock
              title="ایران — بورس کالا"
              subtitle={imeLive ? 'میانگین موزون معاملات هفته از بورس کالا' : 'آخرین داده ذخیره‌شده بورس کالا'}
              color="#2f5d7a"
              rows={chain.map((r) => ({
                name: r.name,
                ratio: r.ratio,
                detail: `${fmtInt(r.price)} ریال/کیلو`,
              }))}
              table={data.imeChain.map((r) => ({
                name: r.product,
                price: fmtInt(r.priceRialKg),
                ratio: r.ratioToBilletPct,
                meta: r.weekStart && r.weekEnd ? `${r.weekStart} تا ${r.weekEnd}` : r.tradeDate,
              }))}
            />
            <RatioBlock
              title="چین / دریایی — Custeel"
              subtitle={custeelLive ? 'نسبت به بیلت تانگشان' : 'از آخرین snapshot'}
              color="#9a3412"
              rows={chinaChain.map((r) => ({
                name: r.name,
                ratio: r.ratio,
                detail: `${fmtNum(r.price, 1)} ${r.unit}`,
              }))}
              table={chinaChain.map((r) => ({
                name: r.name,
                price: fmtNum(r.price, 1),
                ratio: r.ratio,
                meta: r.unit,
              }))}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function RatioBlock({
  title,
  subtitle,
  color,
  rows,
  table,
}: {
  title: string
  subtitle: string
  color: string
  rows: { name: string; ratio: number; detail: string }[]
  table: { name: string; price: string; ratio: number; meta: string }[]
}) {
  if (!rows.length) {
    return (
      <div>
        <h4 className="text-xs font-bold">{title}</h4>
        <p className="mt-2 text-xs text-[var(--color-muted)]">داده نسبت در دسترس نیست.</p>
      </div>
    )
  }
  return (
    <div>
      <h4 className="text-xs font-bold">{title}</h4>
      <p className="mb-2 text-[0.65rem] text-[var(--color-muted)]">{subtitle}</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ right: 12, left: 4 }}>
            <CartesianGrid stroke="#d4cfc4" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7c8a' }} unit="%" />
            <YAxis
              type="category"
              dataKey="name"
              width={108}
              tick={{ fontSize: 10, fill: '#3d4f5f' }}
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
                const detail = (item?.payload as { detail?: string })?.detail
                return [`${fmtNum(Number(v), 1)}٪${detail ? ` · ${detail}` : ''}`, 'نسبت به شمش']
              }}
            />
            <Bar dataKey="ratio" fill={color} radius={[0, 6, 6, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="data-table mt-2">
        <thead>
          <tr>
            <th>محصول</th>
            <th>نرخ</th>
            <th>ضریب</th>
            <th>توضیح</th>
          </tr>
        </thead>
        <tbody>
          {table.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="num">{r.price}</td>
              <td className="num">{fmtNum(r.ratio, 1)}٪</td>
              <td className="num text-[var(--color-muted)]">{r.meta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

