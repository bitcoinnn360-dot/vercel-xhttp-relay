import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bar,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DashboardData, OpsMonthPoint, OpsProductSeries } from '../data/types'
import { changeClass, fmtNum, fmtPct } from '../lib/format'

type Mode = 'production' | 'water' | 'electricity' | 'gas'

const MODES: { id: Mode; label: string }[] = [
  { id: 'production', label: 'تولید' },
  { id: 'water', label: 'آب' },
  { id: 'electricity', label: 'برق' },
  { id: 'gas', label: 'گاز' },
]

const tip = {
  background: '#0f2744',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  fontSize: 11,
  fontFamily: 'Vazirmatn, sans-serif',
}

function lastPoints(months: OpsMonthPoint[], n = 12): OpsMonthPoint[] {
  return months.filter((m) => m.value != null).slice(-n)
}

function chartRows(months: OpsMonthPoint[]) {
  return lastPoints(months, 12).map((m) => ({
    label: m.label,
    current: m.value,
    prior: m.priorValue,
    yoy: m.yoyPct,
  }))
}

export function ProductionOpsSection({ data }: { data: DashboardData }) {
  const bundle = data.productionOps
  const companies = bundle?.companies || []
  const [symbol, setSymbol] = useState(companies[0]?.symbol || '')
  const [mode, setMode] = useState<Mode>('production')
  const company = companies.find((c) => c.symbol === symbol) || companies[0]
  const [productKey, setProductKey] = useState<number | null>(null)

  const activeProduct: OpsProductSeries | null = useMemo(() => {
    if (!company?.products?.length) return null
    const found = company.products.find((p) => p.productKey === productKey)
    return found || company.products[0]
  }, [company, productKey])

  const energy = company?.energy?.find((e) => e.id === mode) || null

  const seriesMonths =
    mode === 'production' ? activeProduct?.months || [] : energy?.months || []
  const rows = chartRows(seriesMonths)
  const unitFa =
    mode === 'production' ? activeProduct?.unitFa || activeProduct?.unit || '' : energy?.unitFa || energy?.unit || ''
  const title =
    mode === 'production'
      ? activeProduct?.productNameFa || 'تولید'
      : energy?.labelFa || MODES.find((m) => m.id === mode)?.label || ''

  const latest = rows.length ? rows[rows.length - 1] : null

  if (!companies.length) {
    return (
      <section id="production" className="scroll-mt-28 space-y-4">
        <div>
          <h2 className="section-title">تولید و انرژی پرتفو</h2>
          <p className="section-sub">داده تولید/انرژی هنوز بارگذاری نشده</p>
        </div>
      </section>
    )
  }

  return (
    <section id="production" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">تولید و انرژی پرتفو</h2>
        <p className="section-sub">
          حجم ماهانه شرکت‌های پرتفو · مقایسه با ماه مشابه سال مالی قبل
          {bundle?.updatedAt
            ? ` · ${new Date(bundle.updatedAt).toLocaleString('fa-IR')}`
            : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {companies.map((c, i) => (
          <motion.button
            key={c.symbol}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => {
              setSymbol(c.symbol)
              setProductKey(null)
            }}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
              company?.symbol === c.symbol
                ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                : 'border-[var(--color-line)] bg-white text-[var(--color-muted)] hover:border-[var(--color-ink)]/40'
            }`}
          >
            {c.symbol}
            <span className="ms-1 opacity-70 font-normal">{c.name}</span>
          </motion.button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => {
          const disabled =
            m.id !== 'production' && !company?.energy?.some((e) => e.id === m.id)
          return (
            <button
              key={m.id}
              type="button"
              disabled={disabled}
              onClick={() => setMode(m.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
                mode === m.id
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                  : 'border-[var(--color-line)] bg-white text-[var(--color-muted)]'
              }`}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {mode === 'production' && company?.products?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {company.products.map((p) => (
            <button
              key={p.productKey}
              type="button"
              onClick={() => setProductKey(p.productKey)}
              className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                activeProduct?.productKey === p.productKey
                  ? 'border-[var(--color-brand-2)] bg-[#e8f1f8] text-[var(--color-brand)]'
                  : 'border-[var(--color-line)] text-[var(--color-muted)]'
              }`}
            >
              {p.productNameFa}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <motion.div
          key={`${company?.symbol}-${mode}-${activeProduct?.productKey || ''}`}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          className="panel p-3 sm:p-4"
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold">
              {company?.symbol} — {title}
              {unitFa ? <span className="ms-2 text-xs font-normal text-[var(--color-muted)]">({unitFa})</span> : null}
            </h3>
            {latest?.yoy != null && (
              <span className={`num text-sm font-bold ${changeClass(latest.yoy)}`}>
                YoY آخرین ماه: {fmtPct(latest.yoy)}
              </span>
            )}
          </div>
          {rows.length ? (
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={48}
                  />
                  <YAxis
                    yAxisId="v"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tickFormatter={(v: number) =>
                      Math.abs(v) >= 1_000_000
                        ? `${fmtNum(v / 1_000_000, 1)}M`
                        : Math.abs(v) >= 1000
                          ? `${fmtNum(v / 1000, 1)}k`
                          : fmtNum(v, 0)
                    }
                  />
                  <YAxis
                    yAxisId="yoy"
                    orientation="right"
                    tick={{ fontSize: 9, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    tickFormatter={(v: number) => `${fmtNum(v, 0)}٪`}
                  />
                  <Tooltip
                    contentStyle={tip}
                    labelStyle={{ color: '#fff' }}
                    formatter={(value, name) => {
                      const n = Number(value)
                      if (name === 'yoy' || name === 'YoY ٪') {
                        return [Number.isFinite(n) ? fmtPct(n) : '—', 'YoY']
                      }
                      return [Number.isFinite(n) ? fmtNum(n, n >= 100 ? 0 : 2) : '—', String(name)]
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    yAxisId="v"
                    dataKey="prior"
                    name="سال قبل"
                    fill="#94a3b8"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    yAxisId="v"
                    dataKey="current"
                    name="امسال"
                    fill="#1a5f9e"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                  />
                  <Line
                    yAxisId="yoy"
                    type="monotone"
                    dataKey="yoy"
                    name="YoY ٪"
                    stroke="#b45309"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="grid h-[240px] place-items-center text-sm text-[var(--color-muted)]">
              برای این بخش داده‌ای نیست
            </div>
          )}
        </motion.div>

        <div className="panel overflow-hidden p-0">
          <div className="border-b border-[var(--color-line)] px-3 py-2 text-xs font-bold">
            جدول ماهانه
          </div>
          <div className="max-h-[340px] overflow-auto">
            <table className="data-table text-xs">
              <thead>
                <tr>
                  <th>ماه</th>
                  <th>مقدار</th>
                  <th>سال قبل</th>
                  <th>YoY</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.label}>
                    <td className="whitespace-nowrap font-semibold">{r.label}</td>
                    <td className="num">{r.current == null ? '—' : fmtNum(r.current, r.current >= 100 ? 0 : 2)}</td>
                    <td className="num text-[var(--color-muted)]">
                      {r.prior == null ? '—' : fmtNum(r.prior, r.prior >= 100 ? 0 : 2)}
                    </td>
                    <td className={`num font-semibold ${r.yoy == null ? '' : changeClass(r.yoy)}`}>
                      {r.yoy == null ? '—' : fmtPct(r.yoy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {mode === 'production' && company ? (
        <YoYSummaryTable
          title={`خلاصه YoY آخرین ماه — ${company.symbol}`}
          rows={company.products.map((p) => {
            const pts = lastPoints(p.months, 1)[0]
            return {
              name: p.productNameFa,
              unit: p.unitFa || p.unit,
              value: pts?.value ?? null,
              prior: pts?.priorValue ?? null,
              yoy: pts?.yoyPct ?? null,
              label: pts?.label,
            }
          })}
        />
      ) : null}

      {mode !== 'production' && companies.length ? (
        <YoYSummaryTable
          title={`مصرف ${MODES.find((m) => m.id === mode)?.label} — مقایسه پرتفو`}
          rows={companies.map((c) => {
            const e = c.energy.find((x) => x.id === mode)
            const pts = e ? lastPoints(e.months, 1)[0] : undefined
            return {
              name: `${c.symbol} · ${c.name}`,
              unit: e?.unitFa || e?.unit || '',
              value: pts?.value ?? null,
              prior: pts?.priorValue ?? null,
              yoy: pts?.yoyPct ?? null,
              label: pts?.label,
            }
          })}
        />
      ) : null}

      <p className="text-[0.65rem] text-[var(--color-muted)]">
        منبع: بورس‌ویو (گزارش فعالیت ماهانه کدال). مقادیر تجمعی سال مالی به ماهانه تبدیل شده‌اند.
        {bundle?.note ? ` ${bundle.note}` : ''}
      </p>
    </section>
  )
}

function YoYSummaryTable({
  title,
  rows,
}: {
  title: string
  rows: { name: string; unit: string; value: number | null; prior: number | null; yoy: number | null; label?: string }[]
}) {
  const usable = rows.filter((r) => r.value != null || r.yoy != null)
  if (!usable.length) return null
  return (
    <div className="panel overflow-x-auto p-2 sm:p-3">
      <h3 className="mb-2 px-2 pt-2 text-sm font-bold">{title}</h3>
      <table className="data-table min-w-[520px]">
        <thead>
          <tr>
            <th>عنوان</th>
            <th>آخرین ماه</th>
            <th>مقدار</th>
            <th>سال قبل</th>
            <th>واحد</th>
            <th>YoY</th>
          </tr>
        </thead>
        <tbody>
          {usable.map((r) => (
            <tr key={r.name}>
              <td className="font-semibold">{r.name}</td>
              <td className="text-[var(--color-muted)] whitespace-nowrap">{r.label || '—'}</td>
              <td className="num">{r.value == null ? '—' : fmtNum(r.value, r.value >= 100 ? 0 : 2)}</td>
              <td className="num text-[var(--color-muted)]">
                {r.prior == null ? '—' : fmtNum(r.prior, r.prior >= 100 ? 0 : 2)}
              </td>
              <td className="text-[var(--color-muted)] whitespace-nowrap">{r.unit}</td>
              <td className={`num font-semibold ${r.yoy == null ? '' : changeClass(r.yoy)}`}>
                {r.yoy == null ? '—' : fmtPct(r.yoy)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
