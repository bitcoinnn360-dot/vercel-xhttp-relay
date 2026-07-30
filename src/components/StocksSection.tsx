import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { DashboardData, StockRow } from '../data/types'
import { changeClass, fmtInt, fmtNum, fmtPct } from '../lib/format'
import { TopTradesBarChart } from './charts/Charts'

const GROUPS = ['همه', 'سرمایه‌گذاری', 'سنگ‌آهن', 'فلزات', 'کابل'] as const

const SECTOR_TONE: Record<string, { bar: string; soft: string; ink: string }> = {
  سرمایه‌گذاری: { bar: '#0b3d6e', soft: '#e8eef5', ink: '#0b3d6e' },
  'سنگ‌آهن': { bar: '#9a3412', soft: '#f5ebe6', ink: '#7c2d12' },
  فلزات: { bar: '#0f766e', soft: '#e6f3f1', ink: '#115e59' },
  کابل: { bar: '#a16207', soft: '#f5efe3', ink: '#854d0e' },
}

type SortKey = 'marketValueBr' | 'dailyPct' | 'weekPct' | 'netIndividualBt'

type DisplayRow =
  | { kind: 'equity'; s: StockRow; sector: string; rowSpan: number; showSector: boolean }
  | { kind: 'industry'; s: StockRow; sector: string }

export function StocksSection({ data }: { data: DashboardData }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('همه')
  const [sortKey, setSortKey] = useState<SortKey>('marketValueBr')

  const displayRows = useMemo(() => {
    const filtered =
      group === 'همه' ? data.stocks : data.stocks.filter((s) => s.group === group)

    const buckets = new Map<string, { eq: StockRow[]; ind?: StockRow }>()
    for (const s of filtered) {
      const g = s.group || '—'
      if (!buckets.has(g)) buckets.set(g, { eq: [] })
      const b = buckets.get(g)!
      if (s.isIndustry) b.ind = s
      else b.eq.push(s)
    }

    const out: DisplayRow[] = []
    for (const [sector, bucket] of buckets) {
      bucket.eq.sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0))
      const n = bucket.eq.length + (bucket.ind ? 1 : 0)
      bucket.eq.forEach((s, i) => {
        out.push({ kind: 'equity', s, sector, rowSpan: n, showSector: i === 0 })
      })
      if (bucket.ind) {
        out.push({
          kind: 'industry',
          s: bucket.ind,
          sector,
        })
      }
    }
    return out
  }, [data.stocks, group, sortKey])

  const equities = displayRows.filter((r) => r.kind === 'equity').map((r) => r.s)
  const liveCount = equities.filter((s) => s.returnsSource).length
  const flowSum = equities.reduce((a, s) => a + (s.netIndividualBt || 0), 0)

  const totals = useMemo(() => {
    if (!equities.length) return null
    const mv = equities.reduce((a, s) => a + (s.marketValueBr || 0), 0)
    const usd = equities.reduce((a, s) => a + (s.marketValueUsdM || 0), 0)
    const vol = equities.reduce((a, s) => a + (s.volume || 0), 0)
    const tv = equities.reduce((a, s) => a + (s.tradeValueMr || 0), 0)
    const net = equities.reduce((a, s) => a + (s.netIndividualBt || 0), 0)
    const wAvg = (key: 'dailyPct' | 'weekPct' | 'monthPct' | 'ytdPct' | 'year3Pct') => {
      let num = 0
      let den = 0
      for (const s of equities) {
        const w = s.marketValueBr || 0
        const v = s[key]
        if (w > 0 && v != null && Number.isFinite(v)) {
          num += w * v
          den += w
        }
      }
      return den > 0 ? Math.round((num / den) * 100) / 100 : 0
    }
    return {
      count: equities.length,
      marketValueBr: mv,
      marketValueUsdM: usd,
      volume: vol,
      tradeValueMr: tv,
      netIndividualBt: Math.round(net * 100) / 100,
      dailyPct: wAvg('dailyPct'),
      weekPct: wAvg('weekPct'),
      monthPct: wAvg('monthPct'),
      ytdPct: wAvg('ytdPct'),
      year3Pct: wAvg('year3Pct'),
    }
  }, [equities])

  const sectorCards = useMemo(() => {
    const map = new Map<string, StockRow[]>()
    for (const s of data.stocks) {
      if (s.isIndustry || (group !== 'همه' && s.group !== group)) continue
      if (!map.has(s.group)) map.set(s.group, [])
      map.get(s.group)!.push(s)
    }
    return [...map.entries()].map(([sector, members]) => {
      const tone = SECTOR_TONE[sector] || SECTOR_TONE.فلزات
      const net = members.reduce((a, m) => a + (m.netIndividualBt || 0), 0)
      const mv = members.reduce((a, m) => a + (m.marketValueBr || 0), 0)
      const daily =
        members.reduce((a, m) => a + (m.dailyPct || 0) * (m.marketValueBr || 0), 0) /
        Math.max(1, members.reduce((a, m) => a + (m.marketValueBr || 0), 0))
      return { sector, tone, net, mv, daily, count: members.length }
    })
  }, [data.stocks, group])

  return (
    <section id="stocks" className="scroll-mt-28 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-title">وضعیت معاملات سهام معدنی و فلزی ایران</h2>
          <p className="section-sub">
            بورس‌ویو · پایانی / تعدیلی · فولادی+مس = فلزات
            {liveCount ? ` · ${liveCount} نماد · ورود پول حقیقی ${fmtNum(flowSum, 1)} م‌ت` : ' · در حال دریافت…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[10px] text-[var(--color-muted)]">مرتب‌سازی</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-lg border border-[var(--color-line)] bg-white/80 px-2 py-1 text-xs"
          >
            <option value="marketValueBr">ارزش بازار</option>
            <option value="dailyPct">بازدهی روز</option>
            <option value="weekPct">بازدهی هفته</option>
            <option value="netIndividualBt">ورود پول حقیقی</option>
          </select>
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  group === g
                    ? 'bg-[var(--color-ink)] text-white'
                    : 'border border-[var(--color-line)] bg-white/60 text-[var(--color-ink-soft)] hover:border-[var(--color-copper)]'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

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
              borderColor: colorMix(c.tone.bar),
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
                <div className="text-[9px] text-[var(--color-muted)]">ارزش بازار</div>
                <div className="num text-sm font-semibold">{fmtInt(c.mv)}</div>
              </div>
              <div className="text-left">
                <div className={`num text-sm font-bold ${changeClass(c.daily)}`}>{fmtPct(c.daily)}</div>
                <div className={`num text-[10px] ${changeClass(c.net)}`}>
                  حقیقی {fmtNum(c.net, 1)}
                </div>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      <div className="panel overflow-x-auto p-2 sm:p-3">
        <table className="data-table stocks-table min-w-[1060px]">
          <thead>
            <tr>
              <th rowSpan={2}>صنعت</th>
              <th rowSpan={2}>نماد</th>
              <th colSpan={2}>ارزش بازار</th>
              <th rowSpan={2}>
                حجم معاملات
                <div className="unit-row">میلیون سهم</div>
              </th>
              <th rowSpan={2}>
                حجم/شناوری
                <div className="unit-row">درصد</div>
              </th>
              <th rowSpan={2}>
                ارزش معاملات
                <div className="unit-row">میلیارد ریال</div>
              </th>
              <th rowSpan={2}>
                قیمت پایانی
                <div className="unit-row">ریال</div>
              </th>
              <th colSpan={5}>بازدهی تعدیل‌شده</th>
              <th colSpan={2}>ورود پول حقیقی</th>
            </tr>
            <tr className="unit-subhead">
              <th>میلیارد ریال</th>
              <th>میلیون دلار</th>
              <th>روزانه</th>
              <th>هفتگی</th>
              <th>ماهانه</th>
              <th>سالانه</th>
              <th>سه‌ساله</th>
              <th>امروز (میلیارد تومان)</th>
              <th>۷ روز معاملاتی</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) =>
              row.kind === 'equity' ? (
                <EquityTr key={`${row.sector}-${row.s.name}`} row={row} />
              ) : (
                <IndustryTr key={`${row.sector}-ind`} row={row} showSector={!equitiesInSector(displayRows, row.sector)} />
              ),
            )}
            {totals ? <TotalsTr totals={totals} /> : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function tradeValueBillionRial(mr?: number) {
  if (mr == null || !Number.isFinite(mr) || mr === 0) return null
  return Math.round(mr / 1000)
}

function fmtTradeValueBr(mr?: number) {
  const v = tradeValueBillionRial(mr)
  return v != null ? fmtInt(v) : '—'
}

function colorMix(hex: string) {
  return `color-mix(in oklab, ${hex} 28%, white)`
}

function equitiesInSector(rows: DisplayRow[], sector: string) {
  return rows.some((r) => r.kind === 'equity' && r.sector === sector)
}

function FlowCell({ value }: { value?: number }) {
  if (value == null || !Number.isFinite(value)) return <td className="num">—</td>
  const abs = Math.abs(value)
  const width = Math.min(100, Math.round((abs / Math.max(abs, 80)) * 100))
  return (
    <td className={`num flow-cell ${changeClass(value)}`}>
      <div className="flow-bar-wrap" aria-hidden>
        <span className={`flow-bar ${value >= 0 ? 'in' : 'out'}`} style={{ width: `${Math.max(12, width)}%` }} />
      </div>
      <span className="relative z-[1] font-semibold">{fmtNum(value, 1)}</span>
    </td>
  )
}

/** Mini bipolar sparkline: positive up / negative down from mid baseline. */
function FlowSparkCell({ values }: { values?: number[] }) {
  if (!values?.length) return <td className="num flow-spark-cell">—</td>
  const max = Math.max(...values.map((v) => Math.abs(v)), 0.01)
  return (
    <td className="flow-spark-cell">
      <div className="flow-spark" title={values.map((v) => fmtNum(v, 1)).join(' · ')} aria-label="ورود پول ۷ روز">
        {values.map((v, i) => {
          const h = Math.max(8, Math.round((Math.abs(v) / max) * 100))
          return (
            <span key={i} className="flow-spark-col">
              <span className="flow-spark-half up">
                {v >= 0 ? <i className="flow-spark-bar in" style={{ height: `${h}%` }} /> : null}
              </span>
              <span className="flow-spark-half down">
                {v < 0 ? <i className="flow-spark-bar out" style={{ height: `${h}%` }} /> : null}
              </span>
            </span>
          )
        })}
      </div>
    </td>
  )
}

function volMillion(volume?: number) {
  if (volume == null || !Number.isFinite(volume)) return '—'
  return fmtNum(volume / 1_000_000, 1)
}

function PctPill({ value }: { value?: number | null }) {
  if (value == null || !Number.isFinite(value)) {
    return <td className="num">—</td>
  }
  return (
    <td className="num">
      <span className={`pct-pill ${changeClass(value)}`}>{fmtPct(value)}</span>
    </td>
  )
}

function EquityTr({
  row,
}: {
  row: Extract<DisplayRow, { kind: 'equity' }>
}) {
  const { s, sector, rowSpan, showSector } = row
  const tone = SECTOR_TONE[sector] || SECTOR_TONE.فلزات
  const isVamaaden = s.symbol === 'ومعادن' || s.name === 'ومعادن' || s.name === 'توسعه معادن و فلزات'
  const rowClass = [s.halted ? 'halted' : '', isVamaaden ? 'flagship-vamaaden' : ''].filter(Boolean).join(' ') || undefined
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={rowClass}
    >
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
          {s.symbol || s.name}
        </span>
        {s.halted ? <span className="halt-tag">متوقف</span> : null}
      </td>
      <td className="num">{s.marketValueBr ? fmtInt(s.marketValueBr) : '—'}</td>
      <td className="num">{s.marketValueUsdM ? fmtInt(s.marketValueUsdM) : '—'}</td>
      <td className="num">{volMillion(s.volume)}</td>
      <td className="num">
        {s.volumeToFloatPct != null && Number.isFinite(s.volumeToFloatPct) ? fmtNum(s.volumeToFloatPct, 2) : '—'}
      </td>
      <td className="num">{fmtTradeValueBr(s.tradeValueMr)}</td>
      <td className="num">{s.closePrice ? fmtInt(s.closePrice) : '—'}</td>
      <PctPill value={s.dailyPct} />
      <PctPill value={s.weekPct} />
      <PctPill value={s.monthPct} />
      <PctPill value={s.ytdPct} />
      <PctPill value={s.year3Pct} />
      <FlowCell value={s.netIndividualBt} />
      <FlowSparkCell values={s.netIndividualWeekBt} />
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
  const tone = SECTOR_TONE[sector] || SECTOR_TONE.فلزات
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
      <td className="font-semibold name-cell">{s.name}</td>
      <td className="num">{s.marketValueBr ? fmtInt(s.marketValueBr) : '—'}</td>
      <td className="num">{s.marketValueUsdM ? fmtInt(s.marketValueUsdM) : '—'}</td>
      <td className="num">{volMillion(s.volume)}</td>
      <td className="num">—</td>
      <td className="num">{fmtTradeValueBr(s.tradeValueMr)}</td>
      <td className="num">—</td>
      <PctPill value={s.dailyPct} />
      <PctPill value={s.weekPct} />
      <PctPill value={s.monthPct} />
      <PctPill value={s.ytdPct} />
      <PctPill value={s.year3Pct} />
      <FlowCell value={s.netIndividualBt} />
      <FlowSparkCell values={s.netIndividualWeekBt} />
    </tr>
  )
}

function TotalsTr({
  totals,
}: {
  totals: {
    count: number
    marketValueBr: number
    marketValueUsdM: number
    volume: number
    tradeValueMr: number
    netIndividualBt: number
    dailyPct: number
    weekPct: number
    monthPct: number
    ytdPct: number
    year3Pct: number
  }
}) {
  return (
    <tr className="totals">
      <td className="sector-cell totals-sector">
        <div className="sector-stack">
          <span className="sector-dot" style={{ background: '#0f172a' }} />
          <span className="sector-label">کل صنایع</span>
        </div>
      </td>
      <td className="font-semibold name-cell">
        جمع کل
        <span className="symbol-tag">{totals.count} نماد</span>
        <span className="adj-tag">وزنی</span>
      </td>
      <td className="num">{fmtInt(totals.marketValueBr)}</td>
      <td className="num">{fmtInt(totals.marketValueUsdM)}</td>
      <td className="num">{volMillion(totals.volume)}</td>
      <td className="num">—</td>
      <td className="num">{fmtTradeValueBr(totals.tradeValueMr)}</td>
      <td className="num">—</td>
      <PctPill value={totals.dailyPct} />
      <PctPill value={totals.weekPct} />
      <PctPill value={totals.monthPct} />
      <PctPill value={totals.ytdPct} />
      <PctPill value={totals.year3Pct} />
      <FlowCell value={totals.netIndividualBt} />
      <td className="num">—</td>
    </tr>
  )
}

function isBondLikeSymbol(name: string): boolean {
  const n = String(name || '').trim()
  if (!n) return true
  if (/^اراد\d*/i.test(n)) return true
  if (/^اخزا\d*/i.test(n)) return true
  if (/^اجاره/i.test(n)) return true
  if (/^مرابحه/i.test(n)) return true
  if (/^ص[ا-ی]{2,}/.test(n) && /\d{2,}$/.test(n)) return true
  if (/\d{2,}$/.test(n) && /(?:اراد|صبا|طبیعت|آسمان|سامان|گستر|قرن)/.test(n)) return true
  return false
}

export function TopTrades({ data }: { data: DashboardData }) {
  const rows = (data.topTrades || [])
    .filter((t) => (t.valueBr || 0) > 0 && !isBondLikeSymbol(t.name))
    .slice(0, 12)
  const total = rows.reduce((a, t) => a + (t.valueBr || 0), 0)
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className="panel p-4"
    >
      <h3 className="mb-1 text-sm font-bold">بیشترین ارزش معاملات</h3>
      <p className="mb-2 text-[10px] text-[var(--color-muted)]">
        ۱۲ نماد برتر · همان جدول ارزش معاملات TradersArena (زیر حقیقی/حقوقی)
      </p>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[10px] text-[var(--color-muted)]">
        <span>رتبه‌بندی زنده · tradersarena.ir/data/mainwatch/symbols</span>
        {total > 0 ? (
          <span>
            جمع ۱۲تای اول:{' '}
            <span className="num font-semibold text-[var(--color-ink-soft)]">{fmtInt(total)}</span>
          </span>
        ) : null}
      </div>
      <TopTradesBarChart rows={rows} height={360} />
    </motion.div>
  )
}
