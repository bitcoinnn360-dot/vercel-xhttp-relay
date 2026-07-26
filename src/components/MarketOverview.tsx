import { motion } from 'framer-motion'
import type { DashboardData } from '../data/types'
import type { HistoryPoint } from '../data/fetchers'
import { changeClass, fmtChange, fmtInt, fmtNum, fmtPct } from '../lib/format'
import { CandlestickChart, FlowBarChart, PriceAreaChart } from './charts/Charts'
import { TopTrades } from './StocksSection'

function Kpi({
  label,
  value,
  unit,
  change,
  changePct,
  delay = 0,
  hint,
}: {
  label: string
  value: string
  unit?: string
  change?: number
  changePct?: number
  delay?: number
  hint?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className="panel p-3.5"
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">
        {value}
        {unit ? <span className="mr-1 text-xs font-medium text-[var(--color-muted)]">{unit}</span> : null}
      </div>
      {changePct !== undefined && (
        <div className={`mt-1.5 text-sm font-semibold num ${changeClass(changePct)}`}>
          {fmtPct(changePct)}
          {change !== undefined ? <span className="mr-2 text-xs opacity-80">({fmtChange(change)})</span> : null}
        </div>
      )}
      {hint ? <div className="mt-1 text-[10px] text-[var(--color-muted)]">{hint}</div> : null}
    </motion.div>
  )
}

export function MarketOverview({
  data,
  histories,
}: {
  data: DashboardData
  histories: Record<string, HistoryPoint[]>
}) {
  const o = data.overview
  const live = o.dataSource === 'live'
  const src = o.fieldSources || {}
  const money = o.moneyFlowSeries.map((d) => ({ label: d.date, value: d.value }))
  const candles = o.candles1401 || []
  const retailDaily = o.retailMoneyFlowDaily
  const blocked = o.blockedSources || []

  return (
    <section id="overview" className="scroll-mt-8 space-y-4">
      <div>
        <h2 className="section-title">خلاصه بازار سرمایه ایران</h2>
        <p className="section-sub">
          {live
            ? 'شاخص‌ها زنده · ارزش بازار = بورس+فرابورس (SourceArena) · پول حقیقی از پارسیس'
            : 'در حال بارگذاری داده زنده…'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={o.tedpix.name}
          value={fmtInt(o.tedpix.value)}
          change={o.tedpix.change}
          changePct={o.tedpix.changePct}
          delay={0.02}
          hint={src.tedpix === 'tgju' ? 'TGJU' : 'شاخص‌بان / TGJU'}
        />
        <Kpi
          label={o.equalWeight.name}
          value={fmtInt(o.equalWeight.value)}
          change={o.equalWeight.change}
          changePct={o.equalWeight.changePct}
          delay={0.05}
          hint={src.equalWeight ? 'شاخص‌بان (زنده)' : 'seed'}
        />
        <Kpi
          label={o.ifb.name}
          value={fmtInt(o.ifb.value)}
          change={o.ifb.change}
          changePct={o.ifb.changePct}
          delay={0.08}
          hint={src.ifb ? 'شاخص‌بان (زنده)' : 'seed'}
        />
        <Kpi
          label="مجموع ارزش بازار"
          value={fmtInt(o.totalMarketValueHmt)}
          unit="همت"
          delay={0.1}
          hint={
            (src.marketValue || '').includes('sourcearena')
              ? 'بورس + فرابورس · SourceArena'
              : blocked.includes('sourcearena')
                ? 'موقت: تابلو شاخص‌بان'
                : src.marketValue || '—'
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="ارزش دلاری بازار"
          value={fmtInt(o.totalMarketValueUsdM)}
          unit="میلیون $"
          hint="ارزش بازار ÷ دلار آزاد TGJU"
        />
        <Kpi label="نرخ دلار" value={fmtInt(o.usdRate)} unit="ریال" hint="TGJU · آزاد" />
        <Kpi
          label="ارزش کل معاملات"
          value={fmtNum(o.totalTradeValueHmt, 2)}
          unit="همت"
          hint={
            (src.totalTrade || '').includes('sourcearena')
              ? 'SourceArena · در یک نگاه'
              : src.totalTrade === 'parsistahlil'
                ? 'پارسیس (کل بازار گزارش)'
                : src.totalTrade || '—'
          }
        />
        <Kpi
          label="معاملات خرد (سهام+صندوق+حق‌تقدم)"
          value={o.retailTradeValueBillionToman != null ? fmtInt(o.retailTradeValueBillionToman) : '—'}
          unit="میلیارد تومان"
          hint={src.retailTrade === 'parsistahlil' ? 'پارسیس‌تحلیل' : 'در انتظار پارسیس'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel p-3.5">
          <div className="kpi-label">خالص ورود/خروج پول حقیقی (امروز)</div>
          <div className={`kpi-value num ${changeClass(retailDaily ?? 0)}`}>
            {retailDaily != null ? fmtInt(retailDaily) : '—'}
            <span className="mr-1 text-xs font-medium text-[var(--color-muted)]">میلیارد تومان</span>
          </div>
          <div className="mt-1 text-[10px] text-[var(--color-muted)]">
            {src.retailMoneyFlowDaily === 'parsistahlil' ? 'آخرین گزارش پارسیس‌تحلیل' : 'در انتظار پارسیس'}
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel p-3.5">
          <div className="kpi-label">خالص ورود پول حقیقی از ابتدای ۱۴۰۴</div>
          <div className={`kpi-value num ${changeClass(o.retailMoneyFlowYtd)}`}>
            {fmtInt(o.retailMoneyFlowYtd)}
            <span className="mr-1 text-xs font-medium text-[var(--color-muted)]">میلیارد تومان</span>
          </div>
          <div className="mt-1 text-[10px] text-[var(--color-muted)]">
            {src.retailMoneyFlowYtd?.includes('parsistahlil')
              ? 'تجمعی از ابتدای ۱۴۰۴ · پایه PDF + روزهای پارسیس'
              : 'در انتظار به‌روزرسانی پارسیس'}
          </div>
        </motion.div>
      </div>

      <div className="panel p-4">
        <h3 className="mb-1 text-sm font-bold">روند شاخص کل در طول روز</h3>
        <p className="mb-2 text-[10px] text-[var(--color-muted)]">
          مسیر امروز از TGJU today-table (رزولوشن چنددقیقه‌ای)
          {o.intradayIndex?.length ? ` · ${o.intradayIndex.length} نقطه` : ''}
        </p>
        <PriceAreaChart
          data={(o.intradayIndex || []).map((x) => ({ label: x.time, value: x.value }))}
          color="#0b3d6e"
          height={240}
          valueLabel="شاخص"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-bold">روند تاریخی شاخص کل (کندل از ۱۴۰۱)</h3>
          <p className="mb-2 text-[10px] text-[var(--color-muted)]">
            OHLC از TGJU · نمایش هفتگی ({candles.length || histories.bourse?.length || 0} روز خام)
          </p>
          <CandlestickChart
            data={
              candles.length
                ? candles
                : (histories.bourse || []).map((p) => ({
                    date: p.date,
                    dateJalali: p.dateJalali,
                    open: p.value,
                    high: p.value,
                    low: p.value,
                    close: p.value,
                  }))
            }
          />
        </div>
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-bold">خالص ورود/خروج پول حقیقی (روزانه)</h3>
          <p className="mb-2 text-[10px] text-[var(--color-muted)]">
            سری روزانه پارسیس‌تحلیل · آخرین نقاط از گزارش وضعیت بازار
          </p>
          <FlowBarChart data={money} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ImpactPanel
          title="تأثیر مثبت/منفی بورس"
          pos={data.impacts?.boursePos || []}
          neg={data.impacts?.bourseNeg || []}
          live={Boolean(o.impactsLive)}
        />
        <ImpactPanel
          title="تأثیر مثبت/منفی فرابورس"
          pos={data.impacts?.ifbPos || []}
          neg={data.impacts?.ifbNeg || []}
          live={Boolean(o.impactsLive)}
        />
        <TopTrades data={data} />
      </div>

      {o.liveNotes?.length ? (
        <div className="panel px-4 py-3 text-[11px] leading-6 text-[var(--color-muted)]">
          {o.liveNotes.map((n) => (
            <div key={n}>• {n}</div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ImpactPanel({
  title,
  pos,
  neg,
  live,
}: {
  title: string
  pos: { symbol: string; impact: number }[]
  neg: { symbol: string; impact: number }[]
  live?: boolean
}) {
  return (
    <div className="panel p-4">
      <h3 className="mb-1 text-sm font-bold">{title}</h3>
      <p className="mb-3 text-[10px] text-[var(--color-muted)]">
        {live ? 'سورت تاثیر بر شاخص · SourceArena' : 'فعلاً از گزارش PDF — در انتظار داده زنده'}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <ul className="space-y-2">
          {(pos || []).map((s, i) => (
            <li key={`${s.symbol || 'p'}-${i}`} className="flex items-center justify-between text-sm">
              <span className="font-semibold">{s.symbol || '—'}</span>
              <span className="num pos">{fmtChange(s.impact)}</span>
            </li>
          ))}
        </ul>
        <ul className="space-y-2">
          {(neg || []).map((s, i) => (
            <li key={`${s.symbol || 'n'}-${i}`} className="flex items-center justify-between text-sm">
              <span className="font-semibold">{s.symbol || '—'}</span>
              <span className="num neg">{fmtChange(s.impact)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
