import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { DashboardData, FinancialLineItem } from '../data/types'
import { fmtNum } from '../lib/format'

export function FinancialsSection({ data }: { data: DashboardData }) {
  const companies = data.financials?.companies || []
  const [symbol, setSymbol] = useState(companies[0]?.symbol || '')
  const company = companies.find((c) => c.symbol === symbol) || companies[0]

  const maxAbs = useMemo(() => {
    if (!company?.lines?.length) return 1
    return Math.max(...company.lines.map((l) => Math.abs(l.value)), 1)
  }, [company])

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
          صورت سود و زیان سالانه · ویژوال سبز/قرمز (الهام از GuruFocus)
          {data.financials?.updatedAt
            ? ` · ${new Date(data.financials.updatedAt).toLocaleString('fa-IR')}`
            : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {companies.map((c, i) => (
          <motion.button
            key={c.symbol}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => setSymbol(c.symbol)}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
              company?.symbol === c.symbol
                ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                : 'border-[var(--color-line)] bg-white text-[var(--color-muted)]'
            }`}
          >
            {c.symbol}
          </motion.button>
        ))}
      </div>

      {company ? (
        <motion.div
          key={company.symbol}
          initial={{ opacity: 0.5 }}
          animate={{ opacity: 1 }}
          className="panel p-4"
        >
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-base font-extrabold text-[var(--color-brand)]">
                {company.symbol} — {company.name}
              </h3>
              <p className="text-xs text-[var(--color-muted)]">
                {company.label}
                {company.industryFa ? ` · ${company.industryFa}` : ''}
                {` · واحد: ${company.scaleLabel}`}
              </p>
            </div>
            <div className="flex gap-3 text-[10px] text-[var(--color-muted)]">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#15803d]" /> درآمد / سود
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#b91c1c]" /> هزینه
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0b3d6e]" /> جمع میانی
              </span>
            </div>
          </div>

          <div className="space-y-2.5">
            {company.lines.map((line, i) => (
              <FinBar key={line.key} line={line} maxAbs={maxAbs} delay={i * 0.03} />
            ))}
          </div>
        </motion.div>
      ) : null}

      <p className="text-[0.65rem] text-[var(--color-muted)]">
        منبع: بورس‌ویو / کدال. طول میله متناسب با قدر مطلق رقم است؛ رنگ بر اساس ماهیت درآمدی یا هزینه‌ای.
      </p>
    </section>
  )
}

function FinBar({ line, maxAbs, delay }: { line: FinancialLineItem; maxAbs: number; delay: number }) {
  const abs = Math.abs(line.value)
  const pct = Math.max(4, Math.round((abs / maxAbs) * 100))
  const color =
    line.kind === 'expense' ? '#b91c1c' : line.kind === 'total' ? '#0b3d6e' : '#15803d'
  const soft =
    line.kind === 'expense'
      ? 'color-mix(in oklab, #b91c1c 12%, white)'
      : line.kind === 'total'
        ? 'color-mix(in oklab, #0b3d6e 10%, white)'
        : 'color-mix(in oklab, #15803d 12%, white)'

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="grid grid-cols-[140px_1fr_88px] items-center gap-2 sm:grid-cols-[180px_1fr_100px]"
    >
      <div className="text-xs font-semibold leading-tight">{line.nameFa}</div>
      <div className="h-7 overflow-hidden rounded-md" style={{ background: soft }}>
        <div
          className="flex h-full items-center justify-end px-2 text-[10px] font-bold text-white transition-all"
          style={{ width: `${pct}%`, background: color, minWidth: abs > 0 ? 28 : 0 }}
        />
      </div>
      <div className="num text-left text-xs font-bold" style={{ color }}>
        {fmtNum(line.value, 0)}
      </div>
    </motion.div>
  )
}
