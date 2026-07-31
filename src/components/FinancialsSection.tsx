import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import type { CompanyFinancials, DashboardData, FinancialLineItem } from '../data/types'
import { fmtNum } from '../lib/format'

type SankeyNode = {
  name: string
  amount: number
  fill: string
  kind: 'product' | 'revenue' | 'profit' | 'expense' | 'other'
}

type SankeyLink = {
  source: number
  target: number
  value: number
  color: string
}

const C = {
  product: '#3b82f6',
  revenue: '#1d4ed8',
  profit: '#15803d',
  profitDark: '#14532d',
  expense: '#b91c1c',
  other: '#2563eb',
  flowGreen: '#86efac',
  flowRed: '#fca5a5',
  flowBlue: '#93c5fd',
}

function lineVal(lines: FinancialLineItem[], key: number): number {
  const row = lines.find((l) => l.key === key)
  return row ? Number(row.value) || 0 : 0
}

/** Merge tiny / unnamed product rows so the left side stays readable. */
function consolidateSegments(
  segments: { productKey: number; name: string; nameFa: string; value: number }[],
  sales: number,
) {
  const kept: { productKey: number; name: string; nameFa: string; value: number }[] = []
  let other = 0
  for (const s of segments) {
    if (!(s.value > 0)) continue
    const pct = sales > 0 ? s.value / sales : 0
    const unnamed = /^سایر\s*\(\d+\)$/.test(s.nameFa) || s.nameFa === 'سایر'
    if (unnamed || pct < 0.03) other += s.value
    else kept.push({ ...s })
  }
  if (other > 0) {
    kept.push({ productKey: 0, name: 'Other', nameFa: 'سایر محصولات', value: Math.round(other) })
  }
  kept.sort((a, b) => b.value - a.value)
  return kept
}

type BottomLine = {
  opLoss?: number
  misc?: number
  finance?: number
  pretax?: number
  tax?: number
  net?: number
}

/**
 * GuruFocus-style income Sankey:
 * Products → Revenue → COGS | Gross Profit → OpEx | Operating Income → … → Tax | Net Income
 *
 * Operating-loss issuers (e.g. بکام): keep the Sankey conserved through OpEx only.
 * Non-operating recovery (misc → pretax → net) is returned as bottom-line KPIs so
 * Recharts does not place a second depth-0 source on the left and tangle the diagram.
 */
function buildIncomeSankey(company: CompanyFinancials): {
  nodes: SankeyNode[]
  links: SankeyLink[]
  sales: number
  bottom?: BottomLine
} | null {
  const lines = company.lines || []
  const sales = Math.abs(lineVal(lines, 44))
  const cogs = Math.abs(lineVal(lines, 48))
  const grossRaw = Math.abs(lineVal(lines, 52))
  const sga = Math.abs(lineVal(lines, 54))
  const otherOp = lineVal(lines, 55)
  const opRaw = lineVal(lines, 56)
  const opProfit = opRaw > 0 ? opRaw : 0
  const opLoss = opRaw < 0 ? Math.abs(opRaw) : 0
  const fin = Math.abs(lineVal(lines, 57))
  const misc = lineVal(lines, 59)
  const pretaxRaw = lineVal(lines, 60)
  const pretax = pretaxRaw > 0 ? pretaxRaw : 0
  const tax = Math.abs(lineVal(lines, 63))
  const netRaw = lineVal(lines, 66)
  const net = netRaw > 0 ? netRaw : 0
  if (!(sales > 0)) return null

  // Conserve Revenue → COGS | Gross (IS rounding can be ±1)
  const cogsFlow = Math.min(cogs, sales)
  const grossFlow = Math.max(sales - cogsFlow, 0)
  const gross = grossFlow || grossRaw

  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  const add = (n: SankeyNode) => {
    nodes.push(n)
    return nodes.length - 1
  }
  const link = (source: number, target: number, value: number, color: string) => {
    const v = Math.round(value)
    if (!(v > 0)) return
    links.push({ source, target, value: v, color })
  }

  // ── 1) Products → Revenue ─────────────────────────────────────────
  const segments = consolidateSegments(company.segments || [], sales)
  let segSum = segments.reduce((a, s) => a + s.value, 0)
  if (segments.length && segSum !== sales) {
    const last = segments[segments.length - 1]
    last.value = Math.max(0, last.value + (sales - segSum))
    segSum = sales
  }
  const iRev = add({ name: 'فروش (درآمد)', amount: sales, fill: C.revenue, kind: 'revenue' })
  if (segments.length) {
    for (const s of segments) {
      const i = add({ name: s.nameFa, amount: s.value, fill: C.product, kind: 'product' })
      link(i, iRev, s.value, C.flowBlue)
    }
  } else {
    const i = add({ name: 'فروش کل', amount: sales, fill: C.product, kind: 'product' })
    link(i, iRev, sales, C.flowBlue)
  }

  // ── 2) Revenue → COGS | Gross Profit ──────────────────────────────
  const iCogs = add({ name: 'بهای تمام‌شده (COGS)', amount: cogsFlow, fill: C.expense, kind: 'expense' })
  const iGross = add({ name: 'سود ناخالص', amount: gross, fill: C.profit, kind: 'profit' })
  link(iRev, iCogs, cogsFlow, C.flowRed)
  link(iRev, iGross, gross, C.flowGreen)

  // ── 3) Gross → OpEx | Operating Income (or loss) ──────────────────
  const otherOpExp = otherOp < 0 ? Math.abs(otherOp) : 0
  const otherOpInc = otherOp > 0 ? otherOp : 0
  const totalOpEx = sga + otherOpExp

  if (opLoss > 0) {
    // All gross is consumed by OpEx. Children scaled to gross (conserved).
    const opexAmt = totalOpEx > 0 ? totalOpEx : gross + opLoss
    const iOpEx = add({
      name: 'جمع هزینه عملیاتی',
      amount: opexAmt,
      fill: C.expense,
      kind: 'expense',
    })
    link(iGross, iOpEx, gross, C.flowRed)

    const parts: { name: string; amount: number }[] = []
    if (sga > 0) parts.push({ name: 'هزینه عمومی و اداری', amount: sga })
    if (otherOpExp > 0) parts.push({ name: 'سایر هزینه عملیاتی', amount: otherOpExp })
    if (!parts.length) parts.push({ name: 'هزینه عملیاتی', amount: opexAmt })

    const partSum = parts.reduce((a, p) => a + p.amount, 0) || 1
    let allocated = 0
    parts.forEach((p, idx) => {
      const share =
        idx === parts.length - 1
          ? Math.max(gross - allocated, 0)
          : Math.round((p.amount / partSum) * gross)
      allocated += share
      const i = add({ name: p.name, amount: p.amount, fill: C.expense, kind: 'expense' })
      link(iOpEx, i, share, C.flowRed)
    })

    if (!links.length) return null
    return {
      nodes,
      links,
      sales,
      bottom: {
        opLoss,
        misc: misc || undefined,
        finance: fin || undefined,
        pretax: pretax || pretaxRaw || undefined,
        tax: tax || undefined,
        net: net || netRaw || undefined,
      },
    }
  }

  if (totalOpEx > 0) {
    const iOpEx = add({ name: 'جمع هزینه عملیاتی', amount: totalOpEx, fill: C.expense, kind: 'expense' })
    const toOpEx = Math.min(totalOpEx, gross)
    link(iGross, iOpEx, toOpEx, C.flowRed)
    // Keep OpEx → children conserved with the inbound toOpEx
    const parts: { name: string; amount: number }[] = []
    if (sga > 0) parts.push({ name: 'هزینه عمومی و اداری', amount: sga })
    if (otherOpExp > 0) parts.push({ name: 'سایر هزینه عملیاتی', amount: otherOpExp })
    const partSum = parts.reduce((a, p) => a + p.amount, 0) || 1
    let allocated = 0
    parts.forEach((p, idx) => {
      const share =
        idx === parts.length - 1
          ? Math.max(toOpEx - allocated, 0)
          : Math.round((p.amount / partSum) * toOpEx)
      allocated += share
      const i = add({ name: p.name, amount: p.amount, fill: C.expense, kind: 'expense' })
      link(iOpEx, i, share, C.flowRed)
    })
  }

  const iOp = add({ name: 'سود عملیاتی', amount: opProfit, fill: C.profit, kind: 'profit' })
  const fromGrossToOp = Math.max(gross - Math.min(totalOpEx, gross), 0)
  link(iGross, iOp, fromGrossToOp, C.flowGreen)
  if (otherOpInc > 0) {
    // otherOpInc as mid inflow would become a left-side source in Recharts;
    // fold it into the operating-profit node label amount only when it already
    // sits inside opProfit via the IS identity. If it is incremental, skip link.
    if (fromGrossToOp + otherOpInc <= opProfit + 1) {
      /* covered by IS identity — no extra source node */
    }
  }

  // ── 4) Operating profit → pretax → tax | net ────────────────────
  // Finance / misc expense come out of op profit; misc income is shown only
  // when it does not require a second depth-0 source. If misc income is large,
  // surface it in bottom KPIs instead of tangling the Sankey.
  const miscExp = misc < 0 ? Math.abs(misc) : 0
  const miscInc = misc > 0 ? misc : 0
  const iPretax = add({ name: 'سود قبل از مالیات', amount: pretax || opProfit, fill: C.profit, kind: 'profit' })
  let fromOp = opProfit
  if (fin > 0) {
    const iFin = add({ name: 'هزینه مالی (بهره)', amount: fin, fill: C.expense, kind: 'expense' })
    const take = Math.min(fin, fromOp)
    link(iOp, iFin, take, C.flowRed)
    fromOp -= take
  }
  if (miscExp > 0) {
    const iMe = add({ name: 'سایر هزینه‌ها', amount: miscExp, fill: C.expense, kind: 'expense' })
    const take = Math.min(miscExp, fromOp)
    link(iOp, iMe, take, C.flowRed)
    fromOp -= take
  }
  link(iOp, iPretax, Math.max(fromOp, 0), C.flowGreen)

  const pretaxNode = pretax || Math.max(fromOp, 0)
  if (tax > 0 && pretaxNode > 0) {
    const iTax = add({ name: 'مالیات', amount: tax, fill: C.expense, kind: 'expense' })
    link(iPretax, iTax, Math.min(tax, pretaxNode), C.flowRed)
  }
  if (net > 0 && pretaxNode > 0) {
    const iNet = add({ name: 'سود خالص', amount: net, fill: C.profitDark, kind: 'profit' })
    link(iPretax, iNet, Math.min(net, Math.max(pretaxNode - tax, 0)) || net, C.flowGreen)
  }

  if (!links.length) return null
  // Misc income as a freestanding Sankey source tangles Recharts layout; when
  // present on a profitable issuer, surface a small note only.
  return {
    nodes,
    links,
    sales,
    bottom: miscInc > 0 ? { misc: miscInc } : undefined,
  }
}

type ChartBundle = {
  nodes: SankeyNode[]
  links: SankeyLink[]
  sales: number
  bottom?: BottomLine
  subtitle: string
}

function makeBuilder() {
  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  const add = (n: SankeyNode) => {
    nodes.push(n)
    return nodes.length - 1
  }
  const link = (source: number, target: number, value: number, color: string) => {
    const v = Math.round(Math.abs(value))
    if (!(v > 0)) return
    links.push({ source, target, value: v, color })
  }
  return { nodes, links, add, link }
}

function absVal(lines: FinancialLineItem[], key: number) {
  return Math.abs(lineVal(lines, key))
}

/** Residual bucket so child sums match a parent total. */
function withResidual(
  parts: { name: string; amount: number; fill?: string }[],
  total: number,
  residualName: string,
) {
  const sum = parts.reduce((a, p) => a + p.amount, 0)
  const residual = Math.round(total - sum)
  if (residual > 0) parts.push({ name: residualName, amount: residual })
  return parts.filter((p) => p.amount > 0)
}

/**
 * Balance sheet Sankey (GuruFocus-style):
 * Current/Non-current assets → Total Assets → Liabilities | Equity → detail
 */
function buildBalanceSankey(company: CompanyFinancials): ChartBundle | null {
  const lines = company.balanceLines || []
  if (!lines.length) return null
  const totalAssets = absVal(lines, 18) || absVal(lines, 43)
  if (!(totalAssets > 0)) return null

  const ca = absVal(lines, 10)
  const nca = absVal(lines, 17)
  const totalLiab = absVal(lines, 32)
  const equity = absVal(lines, 42)
  const cl = absVal(lines, 27)
  const ncl = absVal(lines, 31)

  const caParts = withResidual(
    [
      { name: 'موجودی نقد', amount: absVal(lines, 1) },
      { name: 'سرمایه‌گذاری کوتاه‌مدت', amount: absVal(lines, 2) },
      { name: 'دریافتنی‌ها', amount: absVal(lines, 200) },
      { name: 'موجودی کالا', amount: absVal(lines, 6) },
      { name: 'پیش‌پرداخت‌ها', amount: absVal(lines, 7) },
    ],
    ca || 0,
    'سایر دارایی جاری',
  )
  const ncaParts = withResidual(
    [
      { name: 'سرمایه‌گذاری بلندمدت', amount: absVal(lines, 11) },
      { name: 'دریافتنی بلندمدت', amount: absVal(lines, 14) },
      { name: 'دارایی ثابت مشهود', amount: absVal(lines, 12) },
      { name: 'دارایی نامشهود', amount: absVal(lines, 13) },
      { name: 'سایر دارایی‌ها', amount: absVal(lines, 16) },
    ],
    nca || 0,
    'سایر دارایی غیرجاری',
  )

  const caTotal = ca || caParts.reduce((a, p) => a + p.amount, 0)
  const ncaTotal = nca || ncaParts.reduce((a, p) => a + p.amount, 0)
  let caFlow = caTotal
  let ncaFlow = ncaTotal
  if (caFlow + ncaFlow > 0 && caFlow + ncaFlow !== totalAssets) {
    const s = totalAssets / (caFlow + ncaFlow)
    caFlow = Math.round(caFlow * s)
    ncaFlow = totalAssets - caFlow
  }

  const { nodes, links, add, link } = makeBuilder()
  const iTot = add({ name: 'جمع دارایی‌ها', amount: totalAssets, fill: C.revenue, kind: 'revenue' })
  const iCa = add({ name: 'دارایی جاری', amount: caFlow, fill: '#2563eb', kind: 'revenue' })
  const iNca = add({ name: 'دارایی غیرجاری', amount: ncaFlow, fill: '#1d4ed8', kind: 'revenue' })
  link(iCa, iTot, caFlow, C.flowBlue)
  link(iNca, iTot, ncaFlow, C.flowBlue)

  // Scale part flows to parent
  const linkPartsToParent = (
    parts: { name: string; amount: number }[],
    parentIdx: number,
    parentFlow: number,
    color: string,
  ) => {
    const sum = parts.reduce((a, p) => a + p.amount, 0) || 1
    let alloc = 0
    parts.forEach((p, idx) => {
      const share =
        idx === parts.length - 1
          ? Math.max(parentFlow - alloc, 0)
          : Math.round((p.amount / sum) * parentFlow)
      alloc += share
      const i = add({ name: p.name, amount: p.amount, fill: C.product, kind: 'product' })
      link(i, parentIdx, share, color)
    })
  }
  if (caParts.length && caFlow > 0) linkPartsToParent(caParts, iCa, caFlow, C.flowBlue)
  if (ncaParts.length && ncaFlow > 0) linkPartsToParent(ncaParts, iNca, ncaFlow, '#93c5fd')

  // Right: Total → Liabilities | Equity
  let liabFlow = totalLiab
  let eqFlow = equity
  if (liabFlow + eqFlow > 0 && liabFlow + eqFlow !== totalAssets) {
    const s = totalAssets / (liabFlow + eqFlow)
    liabFlow = Math.round(liabFlow * s)
    eqFlow = totalAssets - liabFlow
  } else if (!(liabFlow + eqFlow > 0)) {
    eqFlow = totalAssets
  }

  const iLiab = add({ name: 'جمع بدهی‌ها', amount: liabFlow, fill: C.expense, kind: 'expense' })
  const iEq = add({ name: 'حقوق صاحبان سهام', amount: eqFlow, fill: C.profit, kind: 'profit' })
  link(iTot, iLiab, liabFlow, C.flowRed)
  link(iTot, iEq, eqFlow, C.flowGreen)

  // Liabilities → CL | NCL
  let clFlow = cl
  let nclFlow = ncl
  if (clFlow + nclFlow > 0 && clFlow + nclFlow !== liabFlow) {
    const s = liabFlow / (clFlow + nclFlow)
    clFlow = Math.round(clFlow * s)
    nclFlow = liabFlow - clFlow
  } else if (!(clFlow + nclFlow > 0) && liabFlow > 0) {
    clFlow = liabFlow
  }
  if (clFlow > 0) {
    const iCl = add({ name: 'بدهی جاری', amount: clFlow, fill: '#dc2626', kind: 'expense' })
    link(iLiab, iCl, clFlow, C.flowRed)
    const clParts = withResidual(
      [
        { name: 'پرداختنی‌ها', amount: absVal(lines, 202) },
        { name: 'حصه جاری تسهیلات', amount: absVal(lines, 25) },
        { name: 'سود سهام پرداختنی', amount: absVal(lines, 24) },
        { name: 'ذخیره مالیات', amount: absVal(lines, 23) },
        { name: 'ذخایر', amount: absVal(lines, 3002) },
      ],
      cl || clFlow,
      'سایر بدهی جاری',
    )
    const sum = clParts.reduce((a, p) => a + p.amount, 0) || 1
    let alloc = 0
    clParts.forEach((p, idx) => {
      const share =
        idx === clParts.length - 1 ? Math.max(clFlow - alloc, 0) : Math.round((p.amount / sum) * clFlow)
      alloc += share
      const i = add({ name: p.name, amount: p.amount, fill: C.expense, kind: 'expense' })
      link(iCl, i, share, C.flowRed)
    })
  }
  if (nclFlow > 0) {
    const iNcl = add({ name: 'بدهی غیرجاری', amount: nclFlow, fill: '#b91c1c', kind: 'expense' })
    link(iLiab, iNcl, nclFlow, C.flowRed)
    const nclParts = withResidual(
      [
        { name: 'تسهیلات بلندمدت', amount: absVal(lines, 29) },
        { name: 'ذخیره پایان خدمت', amount: absVal(lines, 30) },
      ],
      ncl || nclFlow,
      'سایر بدهی غیرجاری',
    )
    const sum = nclParts.reduce((a, p) => a + p.amount, 0) || 1
    let alloc = 0
    nclParts.forEach((p, idx) => {
      const share =
        idx === nclParts.length - 1
          ? Math.max(nclFlow - alloc, 0)
          : Math.round((p.amount / sum) * nclFlow)
      alloc += share
      const i = add({ name: p.name, amount: p.amount, fill: C.expense, kind: 'expense' })
      link(iNcl, i, share, C.flowRed)
    })
  }

  // Equity detail
  const eqParts = withResidual(
    [
      { name: 'سرمایه', amount: absVal(lines, 33) },
      { name: 'اندوخته قانونی', amount: absVal(lines, 36) },
      { name: 'سود انباشته', amount: absVal(lines, 38) },
    ],
    equity || eqFlow,
    'سایر حقوق',
  )
  if (eqParts.length && eqFlow > 0) {
    const sum = eqParts.reduce((a, p) => a + p.amount, 0) || 1
    let alloc = 0
    eqParts.forEach((p, idx) => {
      const share =
        idx === eqParts.length - 1 ? Math.max(eqFlow - alloc, 0) : Math.round((p.amount / sum) * eqFlow)
      alloc += share
      const i = add({ name: p.name, amount: p.amount, fill: C.profit, kind: 'profit' })
      link(iEq, i, share, C.flowGreen)
    })
  }

  if (!links.length) return null
  return {
    nodes,
    links,
    sales: totalAssets,
    subtitle: 'ترکیب دارایی‌ها ← جمع دارایی‌ها ← بدهی‌ها / حقوق صاحبان سهام',
  }
}

/**
 * Cash-flow Sankey (conserved pool):
 * Beginning + inflows → نقد دوره → Ending + outflows
 * Identity: begin + op + inv + fin + fx ≈ end
 */
function buildCashflowSankey(company: CompanyFinancials): ChartBundle | null {
  const lines = company.cashflowLines || []
  if (!lines.length) return null

  const op = lineVal(lines, 132)
  const inv = lineVal(lines, 233)
  const fin = lineVal(lines, 243)
  const begin = absVal(lines, 154)
  const fx = lineVal(lines, 155)
  const end = absVal(lines, 156)
  if (!(end > 0) && !(begin > 0)) return null

  const { nodes, links, add, link } = makeBuilder()

  const inflows = [
    { name: 'نقد ابتدای دوره', value: begin, color: C.flowBlue, fill: C.product, kind: 'product' as const },
    { name: 'جریان عملیاتی', value: op, color: C.flowGreen, fill: C.profit, kind: 'profit' as const },
    { name: 'جریان سرمایه‌گذاری', value: inv, color: C.flowGreen, fill: '#b45309', kind: 'other' as const },
    { name: 'جریان تأمین مالی', value: fin, color: C.flowGreen, fill: C.other, kind: 'other' as const },
    { name: 'اثر نرخ ارز', value: fx, color: C.flowBlue, fill: C.other, kind: 'other' as const },
  ].filter((x) => x.value > 0)

  const outflows = [
    { name: 'جریان عملیاتی (خروج)', value: op < 0 ? -op : 0, fill: C.expense },
    { name: 'جریان سرمایه‌گذاری', value: inv < 0 ? -inv : 0, fill: C.expense },
    { name: 'جریان تأمین مالی', value: fin < 0 ? -fin : 0, fill: C.expense },
    { name: 'اثر نرخ ارز', value: fx < 0 ? -fx : 0, fill: C.expense },
    { name: 'نقد پایان دوره', value: end, fill: C.profitDark },
  ].filter((x) => x.value > 0)

  const inSum = inflows.reduce((a, x) => a + x.value, 0)
  const outSum = outflows.reduce((a, x) => a + x.value, 0)
  const poolAmt = Math.max(inSum, outSum, 1)
  const iPool = add({ name: 'نقد دوره', amount: poolAmt, fill: C.revenue, kind: 'revenue' })

  for (const x of inflows) {
    const i = add({ name: x.name, amount: x.value, fill: x.fill, kind: x.kind })
    link(i, iPool, x.value, x.color)
  }
  for (const x of outflows) {
    const isEnd = x.name === 'نقد پایان دوره'
    const i = add({
      name: x.name,
      amount: x.value,
      fill: x.fill,
      kind: isEnd ? 'profit' : 'expense',
    })
    link(iPool, i, x.value, isEnd ? C.flowGreen : C.flowRed)
  }

  if (!links.length) return null
  return {
    nodes,
    links,
    sales: end || begin || poolAmt,
    subtitle: 'ابتدای دوره + جریان‌ها ← نقد دوره ← پایان دوره / مصارف',
  }
}

function buildStatementChart(
  company: CompanyFinancials,
  stmt: 'income' | 'balance' | 'cashflow',
): ChartBundle | null {
  if (stmt === 'income') {
    const s = buildIncomeSankey(company)
    if (!s) return null
    return {
      ...s,
      subtitle: 'محصولات ← درآمد ← COGS / سود ناخالص ← هزینه عملیاتی / سود ← مالیات / سود خالص',
    }
  }
  if (stmt === 'balance') return buildBalanceSankey(company)
  return buildCashflowSankey(company)
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
      <span
        className={`max-w-[9rem] truncate text-[10px] font-normal leading-tight ${
          active ? 'text-white/75' : 'opacity-70'
        }`}
      >
        {name}
      </span>
    </motion.button>
  )
}

type StmtId = 'income' | 'balance' | 'cashflow'

const STMT_TABS: { id: StmtId; label: string }[] = [
  { id: 'income', label: 'سود و زیان' },
  { id: 'balance', label: 'ترازنامه' },
  { id: 'cashflow', label: 'جریان نقدی' },
]

export function FinancialsSection({ data }: { data: DashboardData }) {
  const companies = data.financials?.companies || []
  const [symbol, setSymbol] = useState(companies[0]?.symbol || '')
  const [stmt, setStmt] = useState<StmtId>('income')
  const company = companies.find((c) => c.symbol === symbol) || companies[0]
  const sankey = useMemo(
    () => (company ? buildStatementChart(company, stmt) : null),
    [company, stmt],
  )

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

  const taxRate =
    company && lineVal(company.lines, 60) !== 0
      ? (Math.abs(lineVal(company.lines, 63)) / Math.abs(lineVal(company.lines, 60))) * 100
      : null

  const title =
    stmt === 'income'
      ? `چگونه ${company?.name} (${company?.symbol}) درآمد می‌سازد`
      : stmt === 'balance'
        ? `ترکیب ترازنامه ${company?.name} (${company?.symbol})`
        : `جریان وجوه نقد ${company?.name} (${company?.symbol})`

  const stmtAvailable = (id: StmtId) => {
    if (!company) return false
    if (id === 'income') return (company.lines || []).length > 0
    if (id === 'balance') return (company.balanceLines || []).length > 0
    return (company.cashflowLines || []).length > 0
  }

  return (
    <section id="financials" className="scroll-mt-28 space-y-4">
      <div>
        <h2 className="section-title">صورت‌های مالی پرتفو</h2>
        <p className="section-sub">
          سود و زیان · ترازنامه · جریان نقدی — ویژوال سبک GuruFocus
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

      <div className="flex flex-wrap gap-1.5">
        {STMT_TABS.map((t) => {
          const ok = stmtAvailable(t.id)
          return (
            <button
              key={t.id}
              type="button"
              disabled={!ok}
              onClick={() => setStmt(t.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold transition ${
                stmt === t.id
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                  : 'border-[var(--color-line)] bg-white text-[var(--color-muted)] hover:border-[var(--color-brand)]/40'
              } disabled:opacity-40`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {company && sankey ? (
        <motion.div
          key={`${company.symbol}-${stmt}`}
          initial={{ opacity: 0.45 }}
          animate={{ opacity: 1 }}
          className="panel overflow-hidden p-3 sm:p-4"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-extrabold text-[var(--color-brand)]">{title}</h3>
              <p className="text-xs text-[var(--color-muted)]">
                {sankey.subtitle} · {company.label}
                {stmt === 'income' && taxRate != null ? ` · نرخ مالیات ${fmtNum(taxRate, 1)}٪` : ''}
                {` · ${company.scaleLabel}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-[10px] text-[var(--color-muted)]">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#93c5fd]" /> محصول / درآمد
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#86efac]" /> سود
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#fca5a5]" /> هزینه
              </span>
            </div>
          </div>

          <div className="h-[460px] w-full sm:h-[520px]" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={{ nodes: sankey.nodes, links: sankey.links }}
                nodeWidth={12}
                nodePadding={18}
                linkCurvature={0.55}
                iterations={72}
                margin={{ top: 8, right: 168, bottom: 8, left: 8 }}
                node={<SankeyNodeBox sales={sankey.sales} />}
                link={<SankeyLinkPath />}
              >
                <Tooltip
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload
                    if (!p) return null
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
                    const pct =
                      sankey.sales > 0 && amount != null ? (Math.abs(Number(amount)) / sankey.sales) * 100 : 0
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

          {stmt === 'income' && sankey.bottom?.opLoss ? (
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50/80 px-3 py-2.5 text-xs leading-6 text-rose-900">
              <span className="font-extrabold">زیان عملیاتی {fmtAmt(sankey.bottom.opLoss)}</span>
              {company.scaleLabel ? ` ${company.scaleLabel}` : ''}
              {' — '}
              هزینه عملیاتی از سود ناخالص بیشتر است. سود نهایی از محل سایر درآمدهای غیرعملیاتی تأمین شده.
            </div>
          ) : null}

          {stmt === 'income' &&
          sankey.bottom &&
          (sankey.bottom.misc ||
            sankey.bottom.finance ||
            sankey.bottom.pretax != null ||
            sankey.bottom.net != null) ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {[
                sankey.bottom.misc != null
                  ? { label: 'سایر درآمدها', value: sankey.bottom.misc, tone: 'good' as const }
                  : null,
                sankey.bottom.finance != null
                  ? { label: 'هزینه مالی', value: -Math.abs(sankey.bottom.finance), tone: 'bad' as const }
                  : null,
                sankey.bottom.pretax != null
                  ? { label: 'سود قبل از مالیات', value: sankey.bottom.pretax, tone: 'good' as const }
                  : null,
                sankey.bottom.tax != null
                  ? { label: 'مالیات', value: -Math.abs(sankey.bottom.tax), tone: 'bad' as const }
                  : null,
                sankey.bottom.net != null
                  ? { label: 'سود خالص', value: sankey.bottom.net, tone: 'good' as const }
                  : null,
              ]
                .filter(Boolean)
                .map((item) => {
                  const row = item!
                  return (
                    <div
                      key={row.label}
                      className="rounded-md border border-[var(--color-line)] px-2.5 py-2 text-right"
                    >
                      <div className="text-[10px] text-[var(--color-muted)]">{row.label}</div>
                      <div
                        className={`num text-sm font-extrabold ${
                          row.tone === 'bad' ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {fmtAmt(row.value)}
                      </div>
                    </div>
                  )
                })}
            </div>
          ) : null}

          {stmt === 'income' && (company.segments?.length || 0) > 0 ? (
            <div className="mt-3">
              <h4 className="mb-1.5 text-xs font-bold text-[var(--color-brand)]">ترکیب فروش محصولات</h4>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {company.segments!.map((s) => {
                  const pct = sankey.sales > 0 ? (s.value / sankey.sales) * 100 : 0
                  return (
                    <div
                      key={`${s.productKey}-${s.nameFa}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs"
                    >
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <span className="inline-block h-2 w-2 rounded-sm bg-[#3b82f6]" />
                        {s.nameFa}
                      </span>
                      <span className="num text-[var(--color-muted)]">
                        {fmtAmt(s.value)}
                        <span className="ms-1">({fmtNum(pct, 1)}٪)</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </motion.div>
      ) : company ? (
        <div className="panel grid h-48 place-items-center text-sm text-[var(--color-muted)]">
          برای {company.symbol} داده کافی برای فلوچارت نیست
        </div>
      ) : null}

      <p className="text-[0.65rem] text-[var(--color-muted)]">
        ساختار مشابه GuruFocus برای سه صورت مالی. ارقام از بورس‌ویو (سالانه، سناریوی واقعی)؛ مقیاس{' '}
        {company?.scaleLabel || 'میلیارد ریال'}.
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
  const labelX = x + width + 6
  const isProduct = payload.kind === 'product'
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={Math.max(height, 2)}
        fill={payload.fill}
        rx={2}
        stroke="#fff"
        strokeWidth={1}
      />
      <text
        x={labelX}
        y={y + Math.max(height, 14) / 2 - (isProduct ? 2 : 6)}
        fontSize={isProduct ? 10 : 11}
        fontWeight={700}
        fill="#0f172a"
      >
        {payload.name}
      </text>
      {!isProduct || height > 14 ? (
        <text x={labelX} y={y + Math.max(height, 14) / 2 + 8} fontSize={9} fill="#64748b">
          {`${fmtAmt(payload.amount)} (${fmtNum(pct, 1)}٪)`}
        </text>
      ) : null}
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
  const d = `M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`
  return (
    <path
      d={d}
      fill="none"
      stroke={payload?.color || '#94a3b8'}
      strokeWidth={Math.max(linkWidth, 1)}
      strokeOpacity={0.8}
    />
  )
}
