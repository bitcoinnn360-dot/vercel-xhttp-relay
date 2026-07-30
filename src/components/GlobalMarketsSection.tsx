import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { CountrySectorRow, DashboardData, GlobalMarketRow } from '../data/types'
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

type SortKey = 'ytdPct' | 'dailyPct' | 'weekPct' | 'monthPct'

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

function heatColor(pct: number | null | undefined) {
  const v = pctOrNull(pct) ?? 0
  const abs = Math.min(Math.abs(v), 20)
  const a = 0.12 + (abs / 20) * 0.45
  if (v > 0.15) return `color-mix(in oklab, #15803d ${Math.round(a * 100)}%, white)`
  if (v < -0.15) return `color-mix(in oklab, #b91c1c ${Math.round(a * 100)}%, white)`
  return '#f8fafc'
}

export function GlobalMarketsSection({ data }: { data: DashboardData }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('همه')
  const [sectorSort, setSectorSort] = useState<SortKey>('ytdPct')
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
      eq.forEach((s, i) => {
        out.push({ kind: 'equity', s, sector, rowSpan: n, showSector: i === 0 })
      })
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
          gross: i.grossMarginPct,
          profit: i.profitMarginPct,
          tone,
        }
      })
  }, [gm.industries, gm.stocks, group])

  const countryRows = useMemo(() => {
    const rows = [...(gm.countrySectors || [])]
    rows.sort((a, b) => (Number(b[sectorSort]) || 0) - (Number(a[sectorSort]) || 0))
    return rows
  }, [gm.countrySectors, sectorSort])

  return (
    <section id="global" className="scroll-mt-28 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-title">بازار جهانی معادن و مواد</h2>
          <p className="section-sub">
            عملکرد سکتور کشورها · شرکت‌های معروف هر صنعت · حاشیه سود
            {gm.updatedAt ? ` · ${new Date(gm.updatedAt).toLocaleString('fa-IR')}` : ''}
          </p>
        </div>
      </div>

      {gm.note ? <p className="text-[0.72rem] text-[var(--color-muted)]">{gm.note}</p> : null}

      <CountrySectorBoard rows={countryRows} sortKey={sectorSort} onSort={setSectorSort} />

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
                <div className="text-[9px] text-[var(--color-muted)]">روزانه / YTD</div>
                <div className={`num text-sm font-bold ${changeClass(c.daily)}`}>
                  {fmtPct(c.daily)}
                  <span className={`ms-2 text-xs font-semibold ${changeClass(c.ytd)}`}>{fmtPct(c.ytd)}</span>
                </div>
              </div>
              <div className="text-left">
                <div className="text-[9px] text-[var(--color-muted)]">حاشیه خالص*</div>
                <div className="num text-sm font-semibold">
                  {c.profit != null ? fmtPct(c.profit) : '—'}
                </div>
              </div>
            </div>
          </motion.button>
        ))}
      </div>
      <p className="text-[0.65rem] text-[var(--color-muted)]">* میانگین حاشیه سود خالص سهام‌های صنعت (بدون ETF)</p>

      <div className="panel overflow-x-auto p-2 sm:p-3">
        <table className="data-table stocks-table min-w-[920px]">
          <thead>
            <tr>
              <th>صنعت</th>
              <th>نماد</th>
              <th>نام</th>
              <th>
                قیمت
                <div className="unit-row">محلی</div>
              </th>
              <th>روزانه</th>
              <th>هفتگی</th>
              <th>YTD</th>
              <th>
                حاشیه ناخالص
                <div className="unit-row">٪</div>
              </th>
              <th>
                حاشیه خالص
                <div className="unit-row">٪</div>
              </th>
              <th>
                P/B
                <div className="unit-row">مرتبه</div>
              </th>
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
                <td colSpan={10} className="py-8 text-center text-sm text-[var(--color-muted)]">
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

function CountrySectorBoard({
  rows,
  sortKey,
  onSort,
}: {
  rows: CountrySectorRow[]
  sortKey: SortKey
  onSort: (k: SortKey) => void
}) {
  if (!rows.length) return null
  const maxAbs = Math.max(...rows.map((r) => Math.abs(Number(r[sortKey]) || 0)), 1)

  return (
    <div className="panel space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">عملکرد سکتور و صنعت در کشورها</h3>
          <p className="text-[0.7rem] text-[var(--color-muted)]">
            شبیه Market → Sector & Industry Performance در GuruFocus — پروکسی ETF مواد پایه / فلزات و معادن
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['dailyPct', 'روزانه'],
              ['weekPct', 'هفتگی'],
              ['monthPct', 'ماهانه'],
              ['ytdPct', 'YTD'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => onSort(k)}
              className={`rounded-md border px-2 py-0.5 text-[0.65rem] font-semibold ${
                sortKey === k
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                  : 'border-[var(--color-line)] text-[var(--color-muted)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r, i) => {
          const v = Number(r[sortKey]) || 0
          const w = Math.max(8, Math.round((Math.abs(v) / maxAbs) * 100))
          return (
            <motion.div
              key={`${r.country}-${r.sector}-${r.symbol}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.025 }}
              className="rounded-lg border border-[var(--color-line)] px-3 py-2.5"
              style={{ background: heatColor(v) }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-[var(--color-ink)]">{r.countryFa}</div>
                  <div className="truncate text-[0.7rem] text-[var(--color-muted)]">
                    {r.sectorFa}
                    <span className="ms-1 opacity-70">· {r.symbol}</span>
                  </div>
                </div>
                <div className={`num shrink-0 text-sm font-extrabold ${changeClass(v)}`}>{fmtPct(v)}</div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${w}%`,
                    background: v >= 0 ? '#15803d' : '#b91c1c',
                    marginInlineStart: v >= 0 ? 0 : 'auto',
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[0.65rem] text-[var(--color-muted)]">
                <span className={changeClass(r.dailyPct ?? 0)}>روز {r.dailyPct != null ? fmtPct(r.dailyPct) : '—'}</span>
                <span className={changeClass(r.ytdPct ?? 0)}>YTD {r.ytdPct != null ? fmtPct(r.ytdPct) : '—'}</span>
              </div>
            </motion.div>
          )
        })}
      </div>
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
        میانگین صنعت {sector}
        {s.count ? <span className="symbol-tag">{s.count} نماد</span> : null}
      </td>
      <td className="num">—</td>
      <PctPill value={s.dailyPct} />
      <PctPill value={s.weekPct} />
      <PctPill value={s.ytdPct} />
      <MarginCell value={s.grossMarginPct} />
      <MarginCell value={s.profitMarginPct} />
      <td className="num">—</td>
    </tr>
  )
}
