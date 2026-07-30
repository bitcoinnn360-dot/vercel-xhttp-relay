import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { DashboardData, GlobalMarketRow, GlobalNewsItem } from '../data/types'
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

function pctOrNull(v: number | null | undefined) {
  return v == null || !Number.isFinite(v) ? null : v
}

function volFmt(v?: number | null) {
  if (v == null || !Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1_000_000) return `${fmtNum(v / 1_000_000, 1)}M`
  if (v >= 1_000) return `${fmtNum(v / 1_000, 1)}K`
  return fmtNum(v, 0)
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

function newsDate(pub?: string) {
  if (!pub) return ''
  const d = new Date(pub)
  if (Number.isNaN(d.getTime())) return pub.slice(0, 16)
  return d.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function GlobalMarketsSection({ data }: { data: DashboardData }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('همه')
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
      const eq = buckets.get(sector) || []
      const ind = indByGroup.get(sector)
      const n = eq.length + (ind ? 1 : 0)
      eq.forEach((s, i) => {
        out.push({ kind: 'equity', s, sector, rowSpan: n, showSector: i === 0 })
      })
      if (ind)
        out.push({
          kind: 'industry',
          s: { ...ind, symbol: ind.symbol || 'IND', nameFa: ind.nameFa || `صنعت ${sector}` },
          sector,
        })
    }
    return out
  }, [gm.stocks, gm.industries, group])

  const sectorCards = useMemo(() => {
    const stocks = gm.stocks || []
    const industries = gm.industries || []
    return industries
      .filter((i) => group === 'همه' || i.group === group)
      .map((i) => {
        const tone = GROUP_TONE[i.group] || GROUP_TONE.شاخص‌ها
        return {
          sector: i.group,
          count: i.count || stocks.filter((s) => s.group === i.group).length,
          daily: i.dailyPct ?? 0,
          week: i.weekPct ?? 0,
          ytd: i.ytdPct ?? 0,
          tone,
        }
      })
  }, [gm.industries, gm.stocks, group])

  const news = gm.news || []

  return (
    <section id="global" className="scroll-mt-28 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-title">بازار جهانی معادن و مواد</h2>
          <p className="section-sub">
            شاخص‌ها و ETFهای صنعتی · سنگ‌آهن · فولاد · مس · طلا — معادل نمای صنایع در سهام معدنی
            {gm.updatedAt ? ` · ${new Date(gm.updatedAt).toLocaleString('fa-IR')}` : ''}
          </p>
        </div>
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
      </div>

      {gm.note ? (
        <p className="text-[0.72rem] text-[var(--color-muted)]">
          {gm.note}
          {gm.source ? ` · منبع: ${gm.source}` : ''}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {sectorCards.map((c, i) => (
          <motion.button
            key={c.sector}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
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
                <div className="text-[9px] text-[var(--color-muted)]">روزانه</div>
                <div className={`num text-sm font-bold ${changeClass(c.daily)}`}>{fmtPct(c.daily)}</div>
              </div>
              <div className="text-left">
                <div className="text-[9px] text-[var(--color-muted)]">YTD</div>
                <div className={`num text-sm font-semibold ${changeClass(c.ytd)}`}>{fmtPct(c.ytd)}</div>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      <div className="panel overflow-x-auto p-2 sm:p-3">
        <table className="data-table stocks-table min-w-[820px]">
          <thead>
            <tr>
              <th>صنعت</th>
              <th>نماد</th>
              <th>نام</th>
              <th>
                قیمت
                <div className="unit-row">دلار</div>
              </th>
              <th>روزانه</th>
              <th>هفتگی</th>
              <th>ماهانه</th>
              <th>YTD</th>
              <th>
                حجم
                <div className="unit-row">سهم</div>
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
                <td colSpan={9} className="py-8 text-center text-sm text-[var(--color-muted)]">
                  داده بازار جهانی هنوز بارگذاری نشده است.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <GlobalNewsBlock news={news} />
    </section>
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
      <td className="num font-semibold">{s.price != null ? fmtNum(s.price, 2) : '—'}</td>
      <PctPill value={s.dailyPct} />
      <PctPill value={s.weekPct} />
      <PctPill value={s.monthPct} />
      <PctPill value={s.ytdPct} />
      <td className="num">{volFmt(s.volume)}</td>
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
      <PctPill value={s.monthPct} />
      <PctPill value={s.ytdPct} />
      <td className="num">—</td>
    </tr>
  )
}

function GlobalNewsBlock({ news }: { news: GlobalNewsItem[] }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="section-title text-base">اخبار و مقالات صنعت و کلان</h3>
        <p className="section-sub">Mining.com · Kitco · Fed — مروری شبیه بخش اخبار GuruFocus</p>
      </div>
      <div className="panel divide-y divide-[var(--color-line)]">
        {news.length ? (
          news.map((n, i) => (
            <motion.a
              key={n.link}
              href={n.link}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.03 }}
              className="block px-4 py-3 transition hover:bg-[#f8fafc]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[0.7rem] font-bold text-[var(--color-muted)]">{n.source}</span>
                <span className="text-[0.65rem] text-[var(--color-muted)]">{newsDate(n.pubDate)}</span>
              </div>
              <div className="mt-1 text-sm font-semibold leading-6 text-[var(--color-ink)]">{n.title}</div>
              {n.summary ? (
                <p className="mt-1 line-clamp-2 text-[0.75rem] leading-5 text-[var(--color-muted)]">{n.summary}</p>
              ) : null}
            </motion.a>
          ))
        ) : (
          <div className="px-4 py-6 text-center text-sm text-[var(--color-muted)]">خبری در دسترس نیست.</div>
        )}
      </div>
    </div>
  )
}
