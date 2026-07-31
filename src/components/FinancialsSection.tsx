import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import type { CompanyFinancials, DashboardData, FinancialLineItem } from '../data/types'
import { fmtNum } from '../lib/format'

type SankeyNode = {
  name: string
  amount: number
  fill: string
  kind: 'revenue' | 'profit' | 'expense' | 'other'
}

type SankeyLink = {
  source: number
  target: number
  value: number
  color: string
}

function lineVal(lines: FinancialLineItem[], key: number): number {
  const row = lines.find((l) => l.key === key)
  return row ? Number(row.value) || 0 : 0
}

/** Build GuruFocus-style income-statement Sankey from Codal/BourseView lines. */
function buildIncomeSankey(company: CompanyFinancials): {
  nodes: SankeyNode[]
  links: SankeyLink[]
  sales: number
} | null {
  const lines = company.lines || []
  const sales = Math.abs(lineVal(lines, 44))
  const cogs = Math.abs(lineVal(lines, 48))
  const gross = Math.abs(lineVal(lines, 52))
  const sga = Math.abs(lineVal(lines, 54))
  const otherOp = lineVal(lines, 55)
  const op = Math.abs(lineVal(lines, 56))
  const fin = Math.abs(lineVal(lines, 57))
  const misc = lineVal(lines, 59)
  const pretax = Math.abs(lineVal(lines, 60))
  const tax = Math.abs(lineVal(lines, 63))
  const net = Math.abs(lineVal(lines, 66))
  if (!(sales > 0)) return null

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  const add = (n: SankeyNode) => {
    nodes.push(n)
    return nodes.length - 1
  }
  const link = (source: number, target: number, value: number, color: string) => {
    if (!(value > 0)) return
    links.push({ source, target, value: Math.round(value), color })
  }

  const GREEN = '#86efac'
  const RED = '#fca5a5'
  const BLUE = '#93c5fd'

  const iRev = add({ name: 'فروش', amount: sales, fill: '#1d4ed8', kind: 'revenue' })
  const iCogs = add({ name: 'بهای تمام‌شده', amount: cogs, fill: '#b91c1c', kind: 'expense' })
  const iGross = add({ name: 'سود ناخالص', amount: gross, fill: '#15803d', kind: 'profit' })
  link(iRev, iCogs, cogs, RED)
  link(iRev, iGross, Math.min(gross, Math.max(sales - cogs, 0)) || gross, GREEN)

  const otherOpExp = otherOp < 0 ? Math.abs(otherOp) : 0
  const otherOpInc = otherOp > 0 ? otherOp : 0
  if (sga > 0) {
    const iSga = add({ name: 'هزینه عمومی و اداری', amount: sga, fill: '#b91c1c', kind: 'expense' })
    link(iGross, iSga, sga, RED)
  }
  if (otherOpExp > 0) {
    const iOe = add({ name: 'سایر هزینه عملیاتی', amount: otherOpExp, fill: '#b91c1c', kind: 'expense' })
    link(iGross, iOe, otherOpExp, RED)
  }

  const iOp = add({ name: 'سود عملیاتی', amount: op, fill: '#15803d', kind: 'profit' })
  const fromGross = Math.max(gross - sga - otherOpExp, 0)
  link(iGross, iOp, fromGross, GREEN)
  if (otherOpInc > 0) {
    const iOi = add({ name: 'سایر درآمد عملیاتی', amount: otherOpInc, fill: '#2563eb', kind: 'other' })
    link(iOi, iOp, otherOpInc, BLUE)
  }

  const iPretax = add({ name: 'سود قبل از مالیات', amount: pretax, fill: '#15803d', kind: 'profit' })
  if (fin > 0) {
    const iFin = add({ name: 'هزینه مالی', amount: fin, fill: '#b91c1c', kind: 'expense' })
    link(iOp, iFin, Math.min(fin, op), RED)
  }
  const miscExp = misc < 0 ? Math.abs(misc) : 0
  const miscInc = misc > 0 ? misc : 0
  if (miscExp > 0) {
    const iMe = add({ name: 'سایر هزینه‌ها', amount: miscExp, fill: '#b91c1c', kind: 'expense' })
    link(iOp, iMe, Math.min(miscExp, Math.max(op - fin, 0)), RED)
  }
  const toPretax = Math.max(op - fin - miscExp, 0)
  link(iOp, iPretax, toPretax, GREEN)
  if (miscInc > 0) {
    const iMi = add({ name: 'سایر درآمدها', amount: miscInc, fill: '#2563eb', kind: 'other' })
    link(iMi, iPretax, miscInc, BLUE)
  }

  if (tax > 0) {
    const iTax = add({ name: 'مالیات', amount: tax, fill: '#b91c1c', kind: 'expense' })
    link(iPretax, iTax, Math.min(tax, pretax), RED)
  }
  if (net > 0) {
    const iNet = add({ name: 'سود خالص', amount: net, fill: '#14532d', kind: 'profit' })
    link(iPretax, iNet, Math.min(net, Math.max(pretax - tax, 0)) || net, GREEN)
  }

  if (!links.length) return null
  return { nodes, links, sales }
}

function fmtAmt(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1000) return `${fmtNum(n / 1000, 1)} هزار`
  return fmtNum(n, 0)
}

function CompanyChip({
  symbol,
  name,
  active,
  onClick,
  delay,
}: {
  symbol: string
  name: string
  active: boolean
  onClick: () => void
  delay: number
}) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onClick={onClick}
      className={`inline-flex min-w-[5.5rem] flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-right transition ${
        active
          ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
          : 'border-[var(--color-line)] bg-white text-[var(--color-muted)] hover:border-[var(--color-ink)]/40'
      }`}
    >
      <span className="text-xs font-extrabold leading-none tracking-wide">{symbol}</span>
      <span className={`max-w-[9rem] truncate text-[10px] font-normal leading-tight ${active ? 'text-white/75' : 'opacity-70'}`}>
        {name}
      </span>
    </motion.button>
  )
}

export function FinancialsSection({ data }: { data: DashboardData }) {
  const companies = data.financials?.companies || []
  const [symbol, setSymbol] = useState(companies[0]?.symbol || '')
  const company = companies.find((c) => c.symbol === symbol) || companies[0]

  const sankey = useMemo(() => (company ? buildIncomeSankey(company) : null), [company])

  if (!companies.length) {
    return (
      <section id="financials" className="scroll-mt-28 space-y-3">
        <div>
          <h2 className="section-title">صورت‌های مالی پرتفو</h2>
          <p className="section-sub">هنوز بارگذاری نشده</p>
        </div>
      </section>
    )
  }

  return (
    <section id="financials" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">صورت‌های مالی پرتفو</h2>
        <p className="section-sub">
          تفکیک صورت سود و زیان — فلوچارت سبز/قرمز (سبک GuruFocus)
          {data.financials?.updatedAt
            ? ` · ${new Date(data.financials.updatedAt).toLocaleString('fa-IR')}`
            : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {companies.map((c, i) => (
          <CompanyChip
            key={c.symbol}
            symbol={c.symbol}
            name={c.name}
            active={company?.symbol === c.symbol}
            onClick={() => setSymbol(c.symbol)}
            delay={i * 0.02}
          />
        ))}
      </div>

      {company && sankey ? (
        <motion.div
          key={company.symbol}
          initial={{ opacity: 0.45 }}
          animate={{ opacity: 1 }}
          className="panel overflow-hidden p-3 sm:p-4"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-extrabold text-[var(--color-brand)]">
                چگونه {company.name} ({company.symbol}) درآمد می‌سازد
              </h3>
              <p className="text-xs text-[var(--color-muted)]">
                تفکیک صورت سود و زیان · {company.label} · واحد: {company.scaleLabel}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-[10px] text-[var(--color-muted)]">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#86efac]" /> سود / حاشیه
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#fca5a5]" /> هزینه
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#93c5fd]" /> سایر درآمد
              </span>
            </div>
          </div>

          <div className="h-[420px] w-full sm:h-[480px]" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={{ nodes: sankey.nodes, links: sankey.links }}
                nodeWidth={14}
                nodePadding={22}
                linkCurvature={0.5}
                iterations={64}
                margin={{ top: 12, right: 160, bottom: 12, left: 12 }}
                node={<SankeyNodeBox sales={sankey.sales} />}
                link={<SankeyLinkPath />}
              >
                <Tooltip
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload
                    if (!p) return null
                    // link tooltip
                    if (p.source != null && p.target != null && typeof p.value === 'number') {
                      const src = typeof p.source === 'object' ? p.source.name : ''
                      const tgt = typeof p.target === 'object' ? p.target.name : ''
                      const pct = sankey.sales > 0 ? (p.value / sankey.sales) * 100 : 0
                      return (
                        <div className="rounded-md bg-[#0f2744] px-2.5 py-1.5 text-[11px] text-white">
                          <div>
                            {src} → {tgt}
                          </div>
                          <div className="num font-bold">
                            {fmtAmt(p.value)} {company.scaleLabel} · {fmtNum(pct, 1)}٪ فروش
                          </div>
                        </div>
                      )
                    }
                    const amount = p.amount ?? p.value
                    const pct = sankey.sales > 0 && amount != null ? (Math.abs(amount) / sankey.sales) * 100 : 0
                    return (
                      <div className="rounded-md bg-[#0f2744] px-2.5 py-1.5 text-[11px] text-white">
                        <div className="font-bold">{p.name}</div>
                        <div className="num">
                          {fmtAmt(Number(amount) || 0)} {company.scaleLabel} · {fmtNum(pct, 1)}٪ فروش
                        </div>
                      </div>
                    )
                  }}
                />
              </Sankey>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {sankey.nodes
              .filter((n) => n.kind === 'profit' || n.kind === 'expense' || n.kind === 'revenue')
              .map((n) => {
                const pct = sankey.sales > 0 ? (n.amount / sankey.sales) * 100 : 0
                return (
                  <div
                    key={n.name}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs"
                  >
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: n.fill }} />
                      {n.name}
                    </span>
                    <span className="num text-[var(--color-muted)]">
                      {fmtAmt(n.amount)}
                      <span className="ms-1">({fmtNum(pct, 1)}٪)</span>
                    </span>
                  </div>
                )
              })}
          </div>
        </motion.div>
      ) : company ? (
        <div className="panel grid h-48 place-items-center text-sm text-[var(--color-muted)]">
          برای {company.symbol} داده کافی برای فلوچارت نیست
        </div>
      ) : null}

      <p className="text-[0.65rem] text-[var(--color-muted)]">
        منبع: بورس‌ویو / کدال. فلو از فروش به هزینه‌ها (قرمز) و سودها (سبز) — مشابه نمودار Income Statement
        Breakdown در GuruFocus. ارقام به {company?.scaleLabel || 'میلیارد ریال'}.
      </p>
    </section>
  )
}

function SankeyNodeBox({
  x,
  y,
  width,
  height,
  payload,
  sales,
}: {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: SankeyNode
  sales: number
}) {
  if (x == null || y == null || width == null || height == null || !payload) return null
  const pct = sales > 0 ? (payload.amount / sales) * 100 : 0
  const labelX = x + width + 8
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={payload.fill}
        rx={3}
        stroke="#fff"
        strokeWidth={1}
      />
      <text x={labelX} y={y + height / 2 - 6} fontSize={11} fontWeight={700} fill="#0f172a">
        {payload.name}
      </text>
      <text x={labelX} y={y + height / 2 + 8} fontSize={10} fill="#64748b">
        {`${fmtAmt(payload.amount)} (${fmtNum(pct, 1)}٪)`}
      </text>
    </g>
  )
}

function SankeyLinkPath(props: {
  sourceX?: number
  targetX?: number
  sourceY?: number
  targetY?: number
  sourceControlX?: number
  targetControlX?: number
  linkWidth?: number
  payload?: { color?: string }
}) {
  const {
    sourceX,
    targetX,
    sourceY,
    targetY,
    sourceControlX,
    targetControlX,
    linkWidth,
    payload,
  } = props
  if (
    sourceX == null ||
    targetX == null ||
    sourceY == null ||
    targetY == null ||
    sourceControlX == null ||
    targetControlX == null ||
    linkWidth == null
  ) {
    return null
  }
  const d = `
    M${sourceX},${sourceY}
    C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}
  `
  return (
    <path
      d={d}
      fill="none"
      stroke={payload?.color || '#94a3b8'}
      strokeWidth={Math.max(linkWidth, 1)}
      strokeOpacity={0.75}
    />
  )
}
