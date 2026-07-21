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
}: {
  data: { label: string; value: number }[]
  color?: string
  height?: number
  valueLabel?: string
}) {
  const gid = `g-${color.replace('#', '')}`
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
