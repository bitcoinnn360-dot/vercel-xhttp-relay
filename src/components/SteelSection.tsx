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
import { changeClass, fmtInt, fmtNum, fmtPct } from '../lib/format'

export function SteelSection({ data }: { data: DashboardData }) {
  const chain = data.imeChain.map((r) => ({
    name: r.product.replace(' (مبارکه)', '').replace(' (میانگین شمش)', ''),
    ratio: r.ratioToBilletPct,
    price: r.priceRialKg,
  }))

  return (
    <section id="steel" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">زنجیره فولاد — چین و ایران</h2>
        <p className="section-sub">
          نرخ‌های چین موقت از TGJU و FRED (جایگزین Custeel) · بورس کالا از گزارش روزانه
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel p-4">
          <div className="kpi-label">{data.inventories.label}</div>
          <div className="kpi-value num text-[1.5rem]">{fmtInt(data.inventories.value)}</div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">هزار تن</div>
          <div className={`mt-2 text-sm font-semibold num ${changeClass(data.inventories.wowChange)}`}>
            تغییر هفتگی: {fmtInt(data.inventories.wowChange)}
          </div>
        </div>
        <div className="panel p-4">
          <div className="kpi-label">نرخ بهره‌برداری کوره بلند تانگشان</div>
          <div className="kpi-value num text-[1.5rem]">{fmtNum(data.bfRate.rate, 2)}٪</div>
          <div className={`mt-2 text-sm font-semibold num ${changeClass(data.bfRate.wowChangePct)}`}>
            تغییر هفتگی: {fmtPct(data.bfRate.wowChangePct)}
          </div>
        </div>
        <div className="panel p-4">
          <div className="kpi-label">موجودی بیلت تانگشان</div>
          <div className="kpi-value num text-[1.5rem]">۱٬۸۶۸</div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">هزار تن · تغییر هفتگی −۴۴.۵</div>
        </div>
      </div>

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
                <th>منطقه</th>
              </tr>
            </thead>
            <tbody>
              {data.steel.map((s) => (
                <tr key={s.id}>
                  <td className="font-semibold">{s.nameFa}</td>
                  <td className="num">{fmtNum(s.value, 1)}</td>
                  <td className="text-[var(--color-muted)]">{s.unit}</td>
                  <td className={`num font-semibold ${changeClass(s.changePct)}`}>{fmtPct(s.changePct)}</td>
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
          <p className="mb-3 text-xs text-[var(--color-muted)]">قیمت ریالی / کیلو و نسبت به بیلت میانگین</p>
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
