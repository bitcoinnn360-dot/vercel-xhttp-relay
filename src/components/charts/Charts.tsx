import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmtChange, fmtInt, fmtNum } from '../../lib/format'
import type { CandlePoint } from '../../data/types'

const tip = {
  background: '#0f2744',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  fontSize: 11,
  fontFamily: 'Vazirmatn, sans-serif',
}
const tipItem = { color: '#fff' }
const tipLabel = { color: '#fff' }
const tipProps = {
  contentStyle: tip,
  itemStyle: tipItem,
  labelStyle: tipLabel,
  wrapperStyle: { outline: 'none' },
}

export function Sparkline({
  data,
  color = '#1a5f9e',
  height = 42,
}: {
  data: { v: number }[]
  color?: string
  height?: number
}) {
  if (!data.length) return <div style={{ height }} className="opacity-30 text-[10px]">بدون تاریخچه</div>
  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function PriceAreaChart({
  data,
  color = '#1a5f9e',
  height = 220,
  valueLabel = 'مقدار',
  /** Zoom Y to the series range (needed for TEDPIX intraday — otherwise 0-baseline flattens the line). */
  zoomY = false,
}: {
  data: { label: string; value: number }[]
  color?: string
  height?: number
  valueLabel?: string
  zoomY?: boolean
}) {
  const gid = `g-${color.replace('#', '')}`
  const vals = data.map((d) => d.value).filter((v) => Number.isFinite(v))
  let yDomain: [number | string, number | string] | undefined
  if (zoomY && vals.length >= 2) {
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.0008, 1)
    yDomain = [min - pad, max + pad]
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? fmtInt(v) : fmtNum(v, 1))}
          />
          <Tooltip {...tipProps} formatter={(v) => [fmtNum(Number(v), 2), valueLabel]} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gid})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function FlowBarChart({
  data,
  height = 220,
}: {
  data: { label: string; value: number }[]
  height?: number
}) {
  const chartData = data.map((row) => ({
    ...row,
    inflow: row.value >= 0 ? row.value : null,
    outflow: row.value < 0 ? row.value : null,
  }))
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={48} />
          <Tooltip {...tipProps} formatter={(v) => [fmtInt(Number(v)), 'میلیارد تومان']} />
          {data.length > 70 ? (
            <Brush
              dataKey="label"
              height={22}
              startIndex={Math.max(0, data.length - 60)}
              travellerWidth={8}
              stroke="#94a3b8"
              tickFormatter={() => ''}
            />
          ) : null}
          <Bar dataKey="inflow" name="ورود پول" stackId="flow" fill="#15803d" radius={[3, 3, 0, 0]} />
          <Bar dataKey="outflow" name="خروج پول" stackId="flow" fill="#b91c1c" radius={[0, 0, 3, 3]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Diverging horizontal bars for index impact (pos/neg). */
export function ImpactDivergingChart({
  pos,
  neg,
  height = 280,
  unit = 'واحد شاخص',
}: {
  pos: { symbol: string; impact: number }[]
  neg: { symbol: string; impact: number }[]
  height?: number
  unit?: string
}) {
  const data = [...(pos || []).slice(0, 5), ...(neg || []).slice(0, 5)]
    .filter((r) => r?.symbol && Number.isFinite(Number(r.impact)))
    .map((r) => ({ symbol: r.symbol, impact: Math.round(Number(r.impact) * 10) / 10 }))
    .sort((a, b) => b.impact - a.impact)

  if (!data.length) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-[var(--color-muted)]">
        در انتظار داده تأثیر…
      </div>
    )
  }

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.impact)), 1)
  // Unique gradient ids per instance (two impact panels on one page)
  const uid = `impact-${Math.abs(data.reduce((s, d) => s + d.impact * 10, 0)).toString(36)}-${data.length}`
  const posId = `${uid}-pos`
  const negId = `${uid}-neg`

  return (
    <div className="chart-ltr" style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 28, left: 4, bottom: 4 }}
          barCategoryGap="18%"
        >
          <defs>
            <linearGradient id={posId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#86efac" />
              <stop offset="100%" stopColor="#15803d" />
            </linearGradient>
            <linearGradient id={negId} x1="1" y1="0" x2="0" y2="0">
              <stop offset="0%" stopColor="#fca5a5" />
              <stop offset="100%" stopColor="#b91c1c" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            domain={[-maxAbs * 1.15, maxAbs * 1.15]}
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => fmtNum(v, Math.abs(v) >= 10 ? 0 : 1)}
          />
          <YAxis
            type="category"
            dataKey="symbol"
            width={58}
            interval={0}
            tick={{ fontSize: 11, fill: '#334155', fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
          />
          <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1.5} />
          <Tooltip
            {...tipProps}
            formatter={(v) => [fmtChange(Number(v)), unit]}
            labelFormatter={(l) => String(l)}
          />
          <Bar dataKey="impact" radius={[4, 4, 4, 4]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.symbol} fill={d.impact >= 0 ? `url(#${posId})` : `url(#${negId})`} />
            ))}
            <LabelList
              dataKey="impact"
              content={(props) => {
                const { x, y, width, height, value } = props as {
                  x?: number | string
                  y?: number | string
                  width?: number | string
                  height?: number | string
                  value?: number | string
                }
                const n = Number(value)
                if (!Number.isFinite(n)) return null
                const xx = Number(x) || 0
                const yy = Number(y) || 0
                const ww = Number(width) || 0
                const hh = Number(height) || 0
                const labelX = n >= 0 ? xx + ww + 4 : xx - 4
                return (
                  <text
                    x={labelX}
                    y={yy + hh / 2}
                    textAnchor={n >= 0 ? 'start' : 'end'}
                    dominantBaseline="middle"
                    fill="#334155"
                    fontSize={10}
                    fontWeight={600}
                  >
                    {fmtChange(n)}
                  </text>
                )
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Ranked horizontal bars for top trade values. */
export function TopTradesBarChart({
  rows,
  height = 280,
  unit = 'میلیارد تومان',
}: {
  rows: { name: string; valueBr: number }[]
  height?: number
  unit?: string
}) {
  const data = (rows || [])
    .filter((r) => r?.name && (r.valueBr || 0) > 0)
    .slice(0, 12)
    .map((r, i) => ({ name: r.name, valueBr: r.valueBr, rank: i + 1 }))

  if (!data.length) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-[var(--color-muted)]">
        در انتظار داده معاملات…
      </div>
    )
  }

  const colors = data.map((_, i) => {
    const t = data.length <= 1 ? 0 : i / (data.length - 1)
    // darkest brand blue → mid teal → light sky (rank 1 = strongest)
    const a = { r: 11, g: 61, b: 110 } // #0b3d6e
    const b = { r: 14, g: 116, b: 144 } // #0e7490
    const c = { r: 56, g: 189, b: 248 } // #38bdf8
    const mix = (x: { r: number; g: number; b: number }, y: { r: number; g: number; b: number }, p: number) => ({
      r: Math.round(x.r + (y.r - x.r) * p),
      g: Math.round(x.g + (y.g - x.g) * p),
      b: Math.round(x.b + (y.b - x.b) * p),
    })
    const mid = t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2)
    return `rgb(${mid.r},${mid.g},${mid.b})`
  })

  const chartH = Math.max(320, data.length * 30)
  return (
    <div className="chart-ltr" style={{ height: Math.max(height, chartH), width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 40, left: 4, bottom: 4 }}
          barCategoryGap="14%"
        >
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => (v >= 1000 ? fmtInt(v) : fmtNum(v, 0))}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={78}
            interval={0}
            tick={{ fontSize: 11, fill: '#334155', fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            {...tipProps}
            formatter={(v) => [fmtNum(Number(v), 1), unit]}
            labelFormatter={(l) => String(l)}
          />
          <Bar dataKey="valueBr" radius={[0, 6, 6, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={colors[i]} />
            ))}
            <LabelList
              dataKey="valueBr"
              position="right"
              formatter={(v) => fmtNum(Number(v), 0)}
              style={{ fill: '#475569', fontSize: 10, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DualLineChart({
  data,
  aKey,
  bKey,
  aLabel,
  bLabel,
  aColor = '#15803d',
  bColor = '#b91c1c',
  height = 220,
  unit = '',
}: {
  data: Record<string, string | number>[]
  aKey: string
  bKey: string
  aLabel: string
  bLabel: string
  aColor?: string
  bColor?: string
  height?: number
  unit?: string
}) {
  if (!data.length) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-[var(--color-muted)]">
        در انتظار داده لحظه‌ای…
      </div>
    )
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={20} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? fmtInt(v) : fmtNum(v, 1))}
          />
          <Tooltip
            {...tipProps}
            formatter={(v, name) => [fmtNum(Number(v), 2) + (unit ? ` ${unit}` : ''), String(name)]}
          />
          <Line type="stepAfter" dataKey={aKey} name={aLabel} stroke={aColor} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="stepAfter" dataKey={bKey} name={bLabel} stroke={bColor} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function TripleLineChart({
  data,
  series,
  height = 220,
  unit = '',
}: {
  data: Record<string, string | number>[]
  series: { key: string; label: string; color: string }[]
  height?: number
  unit?: string
}) {
  if (!data.length) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-[var(--color-muted)]">
        در انتظار داده لحظه‌ای…
      </div>
    )
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={20} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? fmtInt(v) : fmtNum(v, 1))}
          />
          <Tooltip
            {...tipProps}
            formatter={(v, name) => [fmtNum(Number(v), 1) + (unit ? ` ${unit}` : ''), String(name)]}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="stepAfter"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function BreadthBarChart({
  positive,
  negative,
  flat,
  height = 160,
}: {
  positive: number
  negative: number
  flat: number
  height?: number
}) {
  const data = [
    { label: 'مثبت', value: positive, color: '#15803d' },
    { label: 'منفی', value: negative, color: '#b91c1c' },
    { label: 'بدون تغییر', value: flat, color: '#94a3b8' },
  ]
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={36} />
          <Tooltip {...tipProps} formatter={(v) => [fmtInt(Number(v)), 'نماد']} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Weekly OHLC aggregation so ~4y of daily candles stays readable */
function toWeeklyCandles(rows: CandlePoint[], maxDaily = 420): CandlePoint[] {
  if (rows.length <= maxDaily) return rows
  const byWeek = new Map<string, CandlePoint>()
  for (const c of rows) {
    const d = new Date(c.date.replace(/\//g, '-'))
    if (Number.isNaN(d.getTime())) continue
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - ((d.getDay() + 1) % 7))
    const key = weekStart.toISOString().slice(0, 10)
    const prev = byWeek.get(key)
    if (!prev) {
      byWeek.set(key, { ...c, date: key })
    } else {
      byWeek.set(key, {
        date: key,
        dateJalali: c.dateJalali || prev.dateJalali,
        open: prev.open,
        high: Math.max(prev.high, c.high),
        low: Math.min(prev.low, c.low),
        close: c.close,
      })
    }
  }
  return [...byWeek.values()]
}

export function CandlestickChart({
  data,
  height = 280,
  ariaLabel = 'نمودار شمعی',
  weeklyIfLongerThan = 420,
}: {
  data: CandlePoint[]
  height?: number
  ariaLabel?: string
  /** اگر تعداد کندل روزانه بیشتر از این باشد، هفتگی تجمیع می‌شود */
  weeklyIfLongerThan?: number
}) {
  const rows = toWeeklyCandles(data, weeklyIfLongerThan)
  if (!rows.length) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-[var(--color-muted)]">
        بدون کندل
      </div>
    )
  }

  const pad = { top: 12, right: 8, bottom: 28, left: 56 }
  const w = 800
  const h = height
  const lows = rows.map((r) => r.low)
  const highs = rows.map((r) => r.high)
  const min = Math.min(...lows)
  const max = Math.max(...highs)
  const span = max - min || 1
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom
  const yScale = (v: number) => pad.top + ((max - v) / span) * plotH
  const slot = plotW / rows.length
  const bodyW = Math.max(1.5, Math.min(8, slot * 0.55))

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + span * (1 - t))
  const xLabels = [0, Math.floor(rows.length / 2), rows.length - 1].filter((i, idx, arr) => arr.indexOf(i) === idx)

  return (
    <div style={{ height }} className="w-full overflow-hidden" dir="ltr">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" role="img" aria-label={ariaLabel}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={w - pad.right} y1={yScale(v)} y2={yScale(v)} stroke="#e2e8f0" strokeDasharray="3 3" />
            <text x={pad.left - 6} y={yScale(v) + 3} textAnchor="end" fontSize="10" fill="#64748b">
              {fmtInt(v)}
            </text>
          </g>
        ))}
        {rows.map((c, i) => {
          const cx = pad.left + slot * i + slot / 2
          const up = c.close >= c.open
          const color = up ? '#15803d' : '#b91c1c'
          const yO = yScale(c.open)
          const yC = yScale(c.close)
          const bodyTop = Math.min(yO, yC)
          const bodyH = Math.max(1.2, Math.abs(yC - yO))
          return (
            <g key={`${c.date}-${i}`}>
              <title>{`${c.dateJalali || c.date} O:${fmtInt(c.open)} H:${fmtInt(c.high)} L:${fmtInt(c.low)} C:${fmtInt(c.close)}`}</title>
              <line x1={cx} x2={cx} y1={yScale(c.high)} y2={yScale(c.low)} stroke={color} strokeWidth={1} />
              <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
            </g>
          )
        })}
        {xLabels.map((i) => (
          <text
            key={i}
            x={pad.left + slot * i + slot / 2}
            y={h - 8}
            textAnchor="middle"
            fontSize="10"
            fill="#64748b"
          >
            {(rows[i].dateJalali || rows[i].date).slice(0, 7)}
          </text>
        ))}
      </svg>
    </div>
  )
}
