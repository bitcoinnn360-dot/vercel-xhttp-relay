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
        {companies.map((c, i) => {
          const active = company?.symbol === c.symbol
          return (
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
              className={`inline-flex min-w-[5.5rem] flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-right transition ${
                active
                  ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                  : 'border-[var(--color-line)] bg-white text-[var(--color-muted)] hover:border-[var(--color-ink)]/40'
              }`}
            >
              <span className="text-xs font-extrabold leading-none tracking-wide">{c.symbol}</span>
              <span
                className={`max-w-[9rem] truncate text-[10px] font-normal leading-tight ${
                  active ? 'text-white/75' : 'opacity-70'
                }`}
              >
                {c.name}
              </span>
            </motion.button>
          )
        })}
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

      {mode !== 'production' && company ? (
        <EnergyRatePanel
          title={`نرخ ${MODES.find((m) => m.id === mode)?.label} — ${company.symbol}`}
          rates={energy?.rates}
        />
      ) : null}

      {(bundle?.industryEnergyRates || []).length > 0 ? (
        <IndustryRateTables rows={bundle?.industryEnergyRates || []} focus={mode === 'production' ? null : mode} />
      ) : null}

      <p className="text-[0.65rem] text-[var(--color-muted)]">
        منبع: بورس‌ویو (گزارش فعالیت ماهانه کدال). مقادیر تجمعی سال مالی به ماهانه تبدیل شده‌اند.
        نرخ انرژی = هزینه ماهانه ÷ حجم ماهانه (ریال).
        {bundle?.note ? ` ${bundle.note}` : ''}
      </p>
    </section>
  )
}

function fmtRate(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return fmtNum(n / 1_000_000, 2) + ' م'
  if (n >= 1000) return fmtNum(n / 1000, 1) + ' ه'
  return fmtNum(n, 0)
}

function EnergyRatePanel({
  title,
  rates,
}: {
  title: string
  rates?: {
    unitFa?: string
    months?: OpsMonthPoint[]
    latestRate?: number | null
    latestLabel?: string | null
    avg3m?: number | null
    avg6m?: number | null
    avg12m?: number | null
  } | null
}) {
  if (!rates?.months?.length && rates?.latestRate == null) return null
  const recent = lastPoints(rates.months || [], 8)
  return (
    <div className="panel overflow-x-auto p-2 sm:p-3">
      <h3 className="mb-1 px-2 pt-2 text-sm font-bold">{title}</h3>
      <p className="mb-2 px-2 text-[0.65rem] text-[var(--color-muted)]">
        واحد: {rates.unitFa || 'ریال'} · میانگین‌های غلتان روی نرخ ماهانه
      </p>
      <div className="mb-3 grid grid-cols-2 gap-2 px-2 sm:grid-cols-4">
        {[
          { label: 'آخرین ماه', value: rates.latestRate, sub: rates.latestLabel },
          { label: 'میانگین ۳ماهه', value: rates.avg3m },
          { label: 'میانگین ۶ماهه', value: rates.avg6m },
          { label: 'میانگین ۱۲ماهه', value: rates.avg12m },
        ].map((k) => (
          <div key={k.label} className="rounded-md border border-[var(--color-line)] bg-[#f8fafc] px-2.5 py-2">
            <div className="text-[10px] text-[var(--color-muted)]">{k.label}</div>
            <div className="num text-sm font-extrabold text-[var(--color-brand)]">{fmtRate(k.value)}</div>
            {k.sub ? <div className="text-[10px] text-[var(--color-muted)]">{k.sub}</div> : null}
          </div>
        ))}
      </div>
      {recent.length ? (
        <table className="data-table min-w-[420px] text-xs">
          <thead>
            <tr>
              <th>ماه</th>
              <th>نرخ</th>
              <th>سال قبل</th>
              <th>YoY</th>
            </tr>
          </thead>
          <tbody>
            {[...recent].reverse().map((m) => (
              <tr key={m.label}>
                <td className="font-semibold whitespace-nowrap">{m.label}</td>
                <td className="num">{fmtRate(m.value)}</td>
                <td className="num text-[var(--color-muted)]">{fmtRate(m.priorValue)}</td>
                <td className={`num font-semibold ${m.yoyPct == null ? '' : changeClass(m.yoyPct)}`}>
                  {m.yoyPct == null ? '—' : fmtPct(m.yoyPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

function IndustryRateTables({
  rows,
  focus,
}: {
  rows: NonNullable<DashboardData['productionOps']['industryEnergyRates']>
  focus: Mode | null
}) {
  const kinds = (['water', 'electricity', 'gas'] as const).filter((k) => !focus || focus === k)
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-extrabold text-[var(--color-brand)]">میانگین نرخ انرژی به تفکیک صنعت</h3>
      {kinds.map((kind) => {
        const label = MODES.find((m) => m.id === kind)?.label || kind
        const usable = rows.filter((r) => r.energy?.[kind])
        if (!usable.length) return null
        return (
          <div key={kind} className="panel overflow-x-auto p-2 sm:p-3">
            <h4 className="mb-2 px-2 pt-2 text-sm font-bold">{label}</h4>
            <table className="data-table min-w-[640px] text-xs">
              <thead>
                <tr>
                  <th>صنعت</th>
                  <th>شرکت‌ها</th>
                  <th>آخرین ماه</th>
                  <th>نرخ ماه</th>
                  <th>۳ماهه</th>
                  <th>۶ماهه</th>
                  <th>۱۲ماهه / سالانه</th>
                </tr>
              </thead>
              <tbody>
                {usable.map((r) => {
                  const e = r.energy[kind]!
                  return (
                    <tr key={`${r.industry}-${kind}`}>
                      <td className="font-semibold">{r.industryFa}</td>
                      <td className="text-[var(--color-muted)]">{r.symbols.join(' · ')}</td>
                      <td className="whitespace-nowrap">{e.latestLabel || '—'}</td>
                      <td className="num font-semibold">{fmtRate(e.latestRate)}</td>
                      <td className="num">{fmtRate(e.avg3m)}</td>
                      <td className="num">{fmtRate(e.avg6m)}</td>
                      <td className="num">{fmtRate(e.avg12m)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="px-2 pb-1 pt-2 text-[0.65rem] text-[var(--color-muted)]">
              میانگین ساده نرخ ماهانه شرکت‌های همان صنعت · واحد ریال
            </p>
          </div>
        )
      })}
    </div>
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
