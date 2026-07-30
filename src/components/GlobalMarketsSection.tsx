import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  CountrySectorRow,
  DashboardData,
  GlobalMarketRow,
  SectorPerformanceRow,
} from '../data/types'
import { changeClass, fmtNum, fmtPct } from '../lib/format'

const GROUPS = [
  'همه',
  'شاخص‌ها',
  'سنگ‌آهن',
  'فولاد',
  'مس',
  'فلزات گرانبها',
  'آلومینیوم',
  'کامودیتی',
] as const

const GROUP_TONE: Record<string, { bar: string; soft: string; ink: string }> = {
  شاخص‌ها: { bar: '#0b3d6e', soft: '#e8eef5', ink: '#0b3d6e' },
  'سنگ‌آهن': { bar: '#9a3412', soft: '#f5ebe6', ink: '#7c2d12' },
  فولاد: { bar: '#0f766e', soft: '#e6f3f1', ink: '#115e59' },
  مس: { bar: '#b45309', soft: '#f5efe3', ink: '#92400e' },
  'فلزات گرانبها': { bar: '#a16207', soft: '#f7f1e3', ink: '#854d0e' },
  آلومینیوم: { bar: '#475569', soft: '#eef2f6', ink: '#334155' },
  کامودیتی: { bar: '#1d4ed8', soft: '#e8eefc', ink: '#1e3a8a' },
}

type DisplayRow =
  | { kind: 'equity'; s: GlobalMarketRow; sector: string; rowSpan: number; showSector: boolean }
  | { kind: 'industry'; s: GlobalMarketRow; sector: string }

type PeriodKey = 'dailyPct' | 'weekPct' | 'monthPct' | 'ytdPct' | 'year1Pct' | 'year3Pct'

function pctOrNull(v: number | null | undefined) {
  return v == null || !Number.isFinite(v) ? null : v
}

function PctPill({ value }: { value: number | null | undefined }) {
  const v = pctOrNull(value)
  if (v == null) return <td className="num">—</td>
  return (
    <td className="num">
      <span className={`pct-pill ${changeClass(v)}`}>{fmtPct(v)}</span>
    </td>
  )
}

function MarginCell({ value }: { value: number | null | undefined }) {
  const v = pctOrNull(value)
  if (v == null) return <td className="num text-[var(--color-muted)]">—</td>
  return <td className={`num font-semibold ${v >= 0 ? 'pos' : 'neg'}`}>{fmtPct(v)}</td>
}

function fmtCap(v?: number | null) {
  if (v == null || !Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1e12) return `${fmtNum(v / 1e12, 2)}T`
  if (v >= 1e9) return `${fmtNum(v / 1e9, 1)}B`
  if (v >= 1e6) return `${fmtNum(v / 1e6, 0)}M`
  return fmtNum(v, 0)
}

export function GlobalMarketsSection({ data }: { data: DashboardData }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('همه')
  const [period, setPeriod] = useState<PeriodKey>('ytdPct')
  const gm = data.globalMarkets

  const displayRows = useMemo(() => {
    const stocks = gm.stocks || []
    const industries = gm.industries || []
    const filtered = group === 'همه' ? stocks : stocks.filter((s) => s.group === group)
    const indByGroup = new Map(industries.map((i) => [i.group, i]))
    const buckets = new Map<string, GlobalMarketRow[]>()
    for (const s of filtered) {
      const g = s.group || '—'
      if (!buckets.has(g)) buckets.set(g, [])
      buckets.get(g)!.push(s)
    }
    const order = GROUPS.filter((g) => g !== 'همه') as string[]
    const keys = [
      ...order.filter((g) => buckets.has(g)),
      ...[...buckets.keys()].filter((g) => !order.includes(g)),
    ]
    const out: DisplayRow[] = []
    for (const sector of keys) {
      const eq = (buckets.get(sector) || []).slice().sort((a, b) => (b.ytdPct || 0) - (a.ytdPct || 0))
      const ind = indByGroup.get(sector)
      const n = eq.length + (ind ? 1 : 0)
      eq.forEach((s, i) => out.push({ kind: 'equity', s, sector, rowSpan: n, showSector: i === 0 }))
      if (ind) {
        out.push({
          kind: 'industry',
          s: { ...ind, symbol: ind.symbol || 'IND', nameFa: ind.nameFa || `صنعت ${sector}` },
          sector,
        })
      }
    }
    return out
  }, [gm.stocks, gm.industries, group])

  const sectorCards = useMemo(() => {
    const stocks = gm.stocks || []
    return (gm.industries || [])
      .filter((i) => group === 'همه' || i.group === group)
      .map((i) => {
        const tone = GROUP_TONE[i.group] || GROUP_TONE.شاخص‌ها
        return {
          sector: i.group,
          count: i.count || stocks.filter((s) => s.group === i.group).length,
          daily: i.dailyPct ?? 0,
          ytd: i.ytdPct ?? 0,
          y3: i.year3Pct,
          profit: i.profitMarginPct,
          tone,
        }
      })
  }, [gm.industries, gm.stocks, group])

  const sectors = gm.sectorPerformance || []
  const materials = gm.materialsByCountry || gm.countrySectors || []

  return (
    <section id="global" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">بازار جهانی معادن و مواد</h2>
        <p className="section-sub">
          سکتورهای تجمیعی بازارهای عمده · مواد پایه کشورها · شرکت‌های صنعت (میانگین وزنی)
          {gm.updatedAt ? ` · ${new Date(gm.updatedAt).toLocaleString('fa-IR')}` : ''}
        </p>
      </div>
      {gm.note ? <p className="text-[0.72rem] text-[var(--color-muted)]">{gm.note}</p> : null}

      <SectorPerformanceBlock sectors={sectors} materials={materials} period={period} onPeriod={setPeriod} />

      <div className="flex flex-wrap gap-1.5">
        {GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroup(g)}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
              group === g
                ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                : 'border-[var(--color-line)] bg-white text-[var(--color-muted)] hover:border-[var(--color-ink)]/40'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {sectorCards.map((c, i) => (
          <motion.button
            key={c.sector}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            onClick={() => setGroup(c.sector as (typeof GROUPS)[number])}
            className="sector-chip text-right"
            style={{
              background: `linear-gradient(135deg, ${c.tone.soft} 0%, white 70%)`,
              borderColor: `color-mix(in oklab, ${c.tone.bar} 28%, white)`,
            }}
          >
            <div className="sector-chip-bar" style={{ background: c.tone.bar }} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold" style={{ color: c.tone.ink }}>
                {c.sector}
              </span>
              <span className="text-[10px] text-[var(--color-muted)]">{c.count} نماد</span>
            </div>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-[9px] text-[var(--color-muted)]">YTD / ۳ساله (وزنی)</div>
                <div className={`num text-sm font-bold ${changeClass(c.ytd)}`}>
                  {fmtPct(c.ytd)}
                  <span className={`ms-2 text-xs font-semibold ${changeClass(c.y3 ?? 0)}`}>
                    {c.y3 != null ? fmtPct(c.y3) : '—'}
                  </span>
                </div>
              </div>
              <div className="text-left">
                <div className="text-[9px] text-[var(--color-muted)]">حاشیه خالص*</div>
                <div className="num text-sm font-semibold">{c.profit != null ? fmtPct(c.profit) : '—'}</div>
              </div>
            </div>
          </motion.button>
        ))}
      </div>
      <p className="text-[0.65rem] text-[var(--color-muted)]">
        * میانگین صنعت وزنی ارزش بازار (نه ساده) · حاشیه فقط روی سهام‌ها
      </p>

      <div className="panel overflow-x-auto p-2 sm:p-3">
        <table className="data-table stocks-table min-w-[980px]">
          <thead>
            <tr>
              <th>صنعت</th>
              <th>نماد</th>
              <th>نام</th>
              <th>قیمت</th>
              <th>روزانه</th>
              <th>هفتگی</th>
              <th>YTD</th>
              <th>سه‌ساله</th>
              <th>حاشیه ناخالص</th>
              <th>حاشیه خالص</th>
              <th>P/B</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) =>
              row.kind === 'equity' ? (
                <EquityTr key={row.s.symbol} row={row} />
              ) : (
                <IndustryTr
                  key={`${row.sector}-ind`}
                  row={row}
                  showSector={!displayRows.some((r) => r.kind === 'equity' && r.sector === row.sector)}
                />
              ),
            )}
            {!displayRows.length ? (
              <tr>
                <td colSpan={11} className="py-8 text-center text-sm text-[var(--color-muted)]">
                  داده بازار جهانی هنوز بارگذاری نشده است.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SectorPerformanceBlock({
  sectors,
  materials,
  period,
  onPeriod,
}: {
  sectors: SectorPerformanceRow[]
  materials: CountrySectorRow[]
  period: PeriodKey
  onPeriod: (k: PeriodKey) => void
}) {
  const countryMaterials = useMemo(() => aggregateMaterialsByCountry(materials), [materials])

  const sectorChart = useMemo(
    () =>
      [...sectors]
        .map((s) => ({
          name: s.nameFa,
          value: Number(s[period]) || 0,
          fill: (Number(s[period]) || 0) >= 0 ? '#0f766e' : '#b91c1c',
        }))
        .sort((a, b) => a.value - b.value),
    [sectors, period],
  )

  const materialsChart = useMemo(
    () =>
      [...countryMaterials]
        .map((s) => ({
          name: s.countryFa,
          value: Number(s[period]) || 0,
          fill: (Number(s[period]) || 0) >= 0 ? '#9a3412' : '#b91c1c',
        }))
        .sort((a, b) => a.value - b.value),
    [countryMaterials, period],
  )

  const sortedSectors = useMemo(
    () => [...sectors].sort((a, b) => (Number(b[period]) || 0) - (Number(a[period]) || 0)),
    [sectors, period],
  )
  const sortedMats = useMemo(
    () => [...countryMaterials].sort((a, b) => (Number(b[period]) || 0) - (Number(a[period]) || 0)),
    [countryMaterials, period],
  )

  if (!sectors.length && !materials.length) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">Major Global Stock Markets — Sector & Industry Performance</h3>
          <p className="text-[0.7rem] text-[var(--color-muted)]">
            دو نمودار و دو جدول تجمیعی · سکتورهای عمده + مواد پایه کشورها (وزنی)
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-line)] bg-white p-1">
          {(
            [
              ['dailyPct', '۱روز'],
              ['weekPct', '۱هفته'],
              ['monthPct', '۱ماه'],
              ['ytdPct', 'YTD'],
              ['year1Pct', '۱سال'],
              ['year3Pct', '۳سال'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => onPeriod(k)}
              className={`rounded-md px-2.5 py-1 text-[0.68rem] font-bold transition ${
                period === k
                  ? 'bg-[var(--color-brand)] text-white shadow-sm'
                  : 'text-[var(--color-muted)] hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <PerfChart
          title="Performance Comparison — سکتورهای تجمیعی"
          subtitle="Select Sector SPDR · بازدهی نسبی سکتورها"
          data={sectorChart}
          accent="#0f766e"
        />
        <PerfChart
          title="Performance Comparison — Basic Materials"
          subtitle="تجمیع وزنی ETF مواد/معادن هر کشور"
          data={materialsChart}
          accent="#9a3412"
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <PerfTable
          title="Market Cap Performance — سکتورهای تجمیعی"
          subtitle="وزن ≈ AUM صندوق سکتوری"
          rows={sortedSectors.map((s) => ({
            key: s.symbol,
            label: s.nameFa,
            sub: s.symbol,
            cap: s.marketCapUsd || s.aumUsd,
            weight: s.weightPct,
            dailyPct: s.dailyPct,
            weekPct: s.weekPct,
            monthPct: s.monthPct,
            ytdPct: s.ytdPct,
            year1Pct: s.year1Pct,
            year3Pct: s.year3Pct,
          }))}
        />
        <PerfTable
          title="Basic Materials — کشورها (تجمیع‌شده)"
          subtitle="چند نماد یک کشور با وزن AUM ادغام شده‌اند"
          rows={sortedMats.map((s) => ({
            key: s.country,
            label: s.countryFa,
            sub: s.symbols,
            cap: s.marketCapUsd,
            weight: s.weightPct,
            dailyPct: s.dailyPct,
            weekPct: s.weekPct,
            monthPct: s.monthPct,
            ytdPct: s.ytdPct,
            year1Pct: s.year1Pct,
            year3Pct: s.year3Pct,
          }))}
        />
      </div>
    </div>
  )
}

type AggCountryRow = {
  country: string
  countryFa: string
  symbols: string
  marketCapUsd: number | null
  weightPct: number | null
  dailyPct: number | null
  weekPct: number | null
  monthPct: number | null
  ytdPct: number | null
  year1Pct: number | null
  year3Pct: number | null
}

function aggregateMaterialsByCountry(materials: CountrySectorRow[]): AggCountryRow[] {
  const buckets = new Map<string, CountrySectorRow[]>()
  for (const m of materials) {
    const key = m.country || m.countryFa
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(m)
  }

  const rows: AggCountryRow[] = []
  for (const [, list] of buckets) {
    const capSum = list.reduce((a, r) => a + (r.aumUsd || r.marketCapUsd || 0), 0)
    const wAvg = (key: PeriodKey) => {
      let num = 0
      let den = 0
      let plain = 0
      let n = 0
      for (const r of list) {
        const v = r[key]
        if (v == null || !Number.isFinite(v)) continue
        const w = r.aumUsd || r.marketCapUsd || 0
        if (w > 0) {
          num += w * v
          den += w
        } else {
          plain += v
          n += 1
        }
      }
      if (den > 0) return Math.round((num / den) * 100) / 100
      if (n > 0) return Math.round((plain / n) * 100) / 100
      return null
    }
    rows.push({
      country: list[0].country,
      countryFa: list[0].countryFa,
      symbols: list.map((r) => r.symbol).join(' · '),
      marketCapUsd: capSum > 0 ? capSum : null,
      weightPct: null,
      dailyPct: wAvg('dailyPct'),
      weekPct: wAvg('weekPct'),
      monthPct: wAvg('monthPct'),
      ytdPct: wAvg('ytdPct'),
      year1Pct: wAvg('year1Pct'),
      year3Pct: wAvg('year3Pct'),
    })
  }

  const total = rows.reduce((a, r) => a + (r.marketCapUsd || 0), 0)
  for (const r of rows) {
    r.weightPct =
      total > 0 && r.marketCapUsd ? Math.round((r.marketCapUsd / total) * 10000) / 100 : null
  }
  return rows
}

function PerfChart({
  title,
  subtitle,
  data,
  accent,
}: {
  title: string
  subtitle: string
  data: { name: string; value: number; fill: string }[]
  accent: string
}) {
  const values = data.map((d) => d.value)
  const minV = Math.min(0, ...values)
  const maxV = Math.max(0, ...values)
  const pad = Math.max(Math.abs(maxV - minV) * 0.12, 2)
  const domain: [number, number] = [minV - (minV < 0 ? pad : 0), maxV + pad]
  const height = Math.max(280, data.length * 28 + 48)

  return (
    <div
      className="panel overflow-hidden p-3 sm:p-4"
      style={{
        background: `linear-gradient(160deg, color-mix(in oklab, ${accent} 7%, white) 0%, white 55%)`,
      }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-extrabold tracking-tight text-[var(--color-ink)]">{title}</h4>
          <p className="text-[0.65rem] text-[var(--color-muted)]">{subtitle}</p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[0.6rem] font-bold text-white"
          style={{ background: accent }}
        >
          {data.length} مورد
        </span>
      </div>
      <div className="chart-ltr" style={{ direction: 'ltr', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 52, left: 4, bottom: 4 }}
            barCategoryGap="18%"
          >
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              domain={domain}
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
              axisLine={{ stroke: '#cbd5e1' }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={108}
              tick={{ fontSize: 11, fill: '#1e293b', fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1.5} />
            <Tooltip
              cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
              contentStyle={{
                background: '#0f172a',
                border: 'none',
                borderRadius: 10,
                color: '#fff',
                fontSize: 12,
              }}
              formatter={(v) => [`${fmtPct(Number(v))}`, 'بازدهی']}
            />
            <Bar dataKey="value" radius={[0, 7, 7, 0]} barSize={16} isAnimationActive>
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v) => fmtPct(Number(v ?? 0))}
                style={{ fill: '#334155', fontSize: 10, fontWeight: 700 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function PerfTable({
  title,
  subtitle,
  rows,
}: {
  title: string
  subtitle: string
  rows: {
    key: string
    label: string
    sub: string
    cap?: number | null
    weight?: number | null
    dailyPct?: number | null
    weekPct?: number | null
    monthPct?: number | null
    ytdPct?: number | null
    year1Pct?: number | null
    year3Pct?: number | null
  }[]
}) {
  return (
    <div className="panel overflow-x-auto p-2 sm:p-3">
      <h4 className="px-2 pt-2 text-xs font-extrabold">{title}</h4>
      <p className="mb-2 px-2 text-[0.65rem] text-[var(--color-muted)]">{subtitle}</p>
      <table className="data-table min-w-[640px]">
        <thead>
          <tr>
            <th>سکتور / بازار</th>
            <th>ارزش</th>
            <th>وزن</th>
            <th>۱روز</th>
            <th>۱هفته</th>
            <th>YTD</th>
            <th>۱سال</th>
            <th>۳سال</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="font-semibold">
                {r.label}
                <span className="mt-0.5 block text-[0.65rem] font-normal text-[var(--color-muted)]">{r.sub}</span>
              </td>
              <td className="num">{fmtCap(r.cap)}</td>
              <td className="num">{r.weight != null ? `${fmtNum(r.weight, 1)}٪` : '—'}</td>
              <PctPill value={r.dailyPct} />
              <PctPill value={r.weekPct} />
              <PctPill value={r.ytdPct} />
              <PctPill value={r.year1Pct} />
              <PctPill value={r.year3Pct} />
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={8} className="py-6 text-center text-sm text-[var(--color-muted)]">
                داده‌ای نیست
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function EquityTr({ row }: { row: Extract<DisplayRow, { kind: 'equity' }> }) {
  const { s, sector, rowSpan, showSector } = row
  const tone = GROUP_TONE[sector] || GROUP_TONE.شاخص‌ها
  const isEtf = s.kind === 'etf'
  return (
    <motion.tr layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {showSector ? (
        <td className="sector-cell" rowSpan={rowSpan} style={{ background: tone.soft }}>
          <div className="sector-stack">
            <span className="sector-dot" style={{ background: tone.bar }} />
            <span className="sector-label" style={{ color: tone.ink }}>
              {sector}
            </span>
          </div>
        </td>
      ) : null}
      <td className="font-semibold name-cell">
        <span className="name-main" title={s.name}>
          {s.symbol}
        </span>
        {isEtf ? <span className="halt-tag">ETF</span> : null}
      </td>
      <td className="text-[0.8rem] text-[var(--color-muted)]">{s.nameFa || s.name}</td>
      <td className="num font-semibold">
        {s.price != null ? fmtNum(s.price, s.price >= 1000 ? 0 : 2) : '—'}
        {s.currency && s.currency !== 'USD' ? (
          <span className="ms-1 text-[0.6rem] text-[var(--color-muted)]">{s.currency}</span>
        ) : null}
      </td>
      <PctPill value={s.dailyPct} />
      <PctPill value={s.weekPct} />
      <PctPill value={s.ytdPct} />
      <PctPill value={s.year3Pct} />
      <MarginCell value={s.grossMarginPct} />
      <MarginCell value={s.profitMarginPct} />
      <td className="num">{s.priceToBook != null ? fmtNum(s.priceToBook, 2) : '—'}</td>
    </motion.tr>
  )
}

function IndustryTr({
  row,
  showSector,
}: {
  row: Extract<DisplayRow, { kind: 'industry' }>
  showSector: boolean
}) {
  const { s, sector } = row
  const tone = GROUP_TONE[sector] || GROUP_TONE.شاخص‌ها
  return (
    <tr className="industry">
      {showSector ? (
        <td className="sector-cell" style={{ background: tone.soft }}>
          <div className="sector-stack">
            <span className="sector-dot" style={{ background: tone.bar }} />
            <span className="sector-label" style={{ color: tone.ink }}>
              {sector}
            </span>
          </div>
        </td>
      ) : null}
      <td className="font-semibold name-cell" colSpan={2}>
        میانگین وزنی صنعت {sector}
        {s.count ? <span className="symbol-tag">{s.count} نماد</span> : null}
      </td>
      <td className="num">—</td>
      <PctPill value={s.dailyPct} />
      <PctPill value={s.weekPct} />
      <PctPill value={s.ytdPct} />
      <PctPill value={s.year3Pct} />
      <MarginCell value={s.grossMarginPct} />
      <MarginCell value={s.profitMarginPct} />
      <td className="num">—</td>
    </tr>
  )
}
