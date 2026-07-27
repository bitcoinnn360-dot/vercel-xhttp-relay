import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmtInt, fmtNum } from '../../lib/format'
import type { CandlePoint } from '../../data/types'

const tip = {
  background: '#0f2744',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  fontSize: 11,
  fontFamily: 'Vazirmatn, sans-serif',
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
          <Tooltip contentStyle={tip} formatter={(v) => [fmtNum(Number(v), 2), valueLabel]} />
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
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={48} />
          <Tooltip contentStyle={tip} formatter={(v) => [fmtInt(Number(v)), 'میلیارد تومان']} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.value >= 0 ? '#15803d' : '#b91c1c'} />
            ))}
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
            contentStyle={tip}
            formatter={(v, name) => [fmtNum(Number(v), 2) + (unit ? ` ${unit}` : ''), String(name)]}
          />
          <Line type="monotone" dataKey={aKey} name={aLabel} stroke={aColor} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey={bKey} name={bLabel} stroke={bColor} strokeWidth={2} dot={false} />
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
          <Tooltip contentStyle={tip} formatter={(v) => [fmtInt(Number(v)), 'نماد']} />
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
function toWeeklyCandles(rows: CandlePoint[]): CandlePoint[] {
  if (rows.length <= 420) return rows
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
}: {
  data: CandlePoint[]
  height?: number
}) {
  const rows = toWeeklyCandles(data)
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
    <div style={{ height }} className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" role="img" aria-label="کندل شاخص کل از ۱۴۰۱">
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
