import { motion } from 'framer-motion'
import type { DashboardData } from '../data/types'
import type { HistoryPoint } from '../data/fetchers'
import { changeClass, fmtChange, fmtInt, fmtNum, fmtPct } from '../lib/format'
import { BreadthBarChart, CandlestickChart, DualLineChart, FlowBarChart, TripleLineChart, PriceAreaChart } from './charts/Charts'
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
  const pulse = o.marketPulse
  const pulseHist = o.marketPulseHistory || []
  const hasHist = pulseHist.length > 0
  const breadthSeries = hasHist
    ? pulseHist.map((p) => ({
        label: p.time,
        positive: p.positive ?? 0,
        negative: p.negative ?? 0,
      }))
    : pulse?.breadth
      ? [
          {
            label: pulse.time || 'الان',
            positive: pulse.breadth.positive,
            negative: pulse.breadth.negative,
          },
        ]
      : []
  const flowSeries = hasHist
    ? pulseHist.map((p) => ({
        label: p.time,
        stocks: p.flowStocks ?? 0,
        equityFunds: p.flowEquityFunds ?? 0,
        fixedIncome: p.flowFixedIncome ?? 0,
        basicMetals: p.flowBasicMetals ?? 0,
        metalOres: p.flowMetalOres ?? 0,
        goldFunds: p.flowGoldFunds ?? 0,
      }))
    : pulse
      ? [
          {
            label: pulse.time || 'الان',
            stocks: pulse.flowStocksBillionToman ?? 0,
            equityFunds: pulse.flowEquityFundsBillionToman ?? 0,
            fixedIncome: pulse.flowFixedIncomeBillionToman ?? 0,
            basicMetals: pulse.flowBasicMetalsBillionToman ?? 0,
            metalOres: pulse.flowMetalOresBillionToman ?? 0,
            goldFunds: pulse.flowGoldFundsBillionToman ?? 0,
          },
        ]
      : []
  // drop points that predate the multi-series shape (all zeros while current is non-zero)
  const flowHasSignal =
    pulse &&
    ((pulse.flowStocksBillionToman ?? 0) !== 0 ||
      (pulse.flowEquityFundsBillionToman ?? 0) !== 0 ||
      (pulse.flowFixedIncomeBillionToman ?? 0) !== 0 ||
      (pulse.flowBasicMetalsBillionToman ?? 0) !== 0 ||
      (pulse.flowMetalOresBillionToman ?? 0) !== 0 ||
      (pulse.flowGoldFundsBillionToman ?? 0) !== 0)
  const flowSeriesClean = flowHasSignal
    ? flowSeries.filter(
        (p) =>
          p.stocks !== 0 ||
          p.equityFunds !== 0 ||
          p.fixedIncome !== 0 ||
          p.basicMetals !== 0 ||
          p.metalOres !== 0 ||
          p.goldFunds !== 0 ||
          p.label === (pulse.time || 'الان'),
      )
    : flowSeries

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
            (src.marketValue || '').includes('index-adjusted')
              ? 'آخرین رسمی × تغییر شاخص امروز'
              : (src.marketValue || '').includes('sourcearena')
                ? 'بورس + فرابورس · SourceArena'
                : (src.marketValue || '').includes('shakhesban')
                  ? 'تابلو شاخص‌بان (پشتیبان)'
                  : (src.marketValue || '').includes('cache') || (src.marketValue || '').includes('deployed')
                    ? 'آخرین مقدار معتبر (کش)'
                    : blocked.includes('sourcearena')
                      ? 'موقت: پشتیبان'
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
              : (src.totalTrade || '').includes('tradersarena')
                ? 'TradersArena · ارزش معاملات بازار'
                : (src.totalTrade || '').includes('shakhesban')
                  ? 'تابلو شاخص‌بان'
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
          zoomY
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
          sourceHint={o.fieldSources?.impacts}
        />
        <ImpactPanel
          title="تأثیر مثبت/منفی فرابورس"
          pos={data.impacts?.ifbPos || []}
          neg={data.impacts?.ifbNeg || []}
          live={Boolean(o.impactsLive)}
          sourceHint={o.fieldSources?.impacts}
        />
        <TopTrades data={data} />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-bold">پالس لحظه‌ای بازار (الگوی TradersArena)</h3>
        <p className="mb-3 text-[10px] text-[var(--color-muted)]">
          وضعیت نمادها و ورود پول حقیقی · منبع TradersArena
          {pulse?.time ? ` · آخرین نمونه ${pulse.time}` : ''}
          {pulseHist.length > 1 ? ` · ${pulseHist.length} نقطه از ۹:۰۰` : ''}
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="panel p-4">
            <h4 className="mb-1 text-sm font-bold">نمادهای مثبت / منفی</h4>
            <p className="mb-2 text-[10px] text-[var(--color-muted)]">
              مثبت {fmtInt(pulse?.breadth?.positive ?? 0)} · منفی {fmtInt(pulse?.breadth?.negative ?? 0)}
              {pulse?.breadth?.flat ? ` · بدون تغییر ${fmtInt(pulse.breadth.flat)}` : ''}
            </p>
            {pulse?.breadth ? (
              <BreadthBarChart
                positive={pulse.breadth.positive}
                negative={pulse.breadth.negative}
                flat={pulse.breadth.flat}
              />
            ) : (
              <DualLineChart
                data={breadthSeries}
                aKey="positive"
                bKey="negative"
                aLabel="مثبت"
                bLabel="منفی"
                unit="نماد"
              />
            )}
            {breadthSeries.length > 1 ? (
              <div className="mt-2">
                <DualLineChart
                  data={breadthSeries}
                  aKey="positive"
                  bKey="negative"
                  aLabel="مثبت"
                  bLabel="منفی"
                  height={140}
                  unit="نماد"
                />
              </div>
            ) : null}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="panel p-4"
          >
            <h4 className="mb-1 text-sm font-bold">ورود پول حقیقی لحظه‌ای</h4>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-[var(--color-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-[2px] w-4 rounded-full bg-[#15803d]" aria-hidden />
                سهام و حق‌تقدم:{' '}
                <span className={`num font-semibold ${changeClass(pulse?.flowStocksBillionToman ?? 0)}`}>
                  {fmtNum(pulse?.flowStocksBillionToman ?? 0, 1)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-[2px] w-4 rounded-full bg-[#1a5f9e]" aria-hidden />
                ص.سهامی:{' '}
                <span className={`num font-semibold ${changeClass(pulse?.flowEquityFundsBillionToman ?? 0)}`}>
                  {fmtNum(pulse?.flowEquityFundsBillionToman ?? 0, 1)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-[2px] w-4 rounded-full bg-[#b45309]" aria-hidden />
                ص.درآمدثابت:{' '}
                <span className={`num font-semibold ${changeClass(pulse?.flowFixedIncomeBillionToman ?? 0)}`}>
                  {fmtNum(pulse?.flowFixedIncomeBillionToman ?? 0, 1)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-[2px] w-4 rounded-full bg-[#9a3412]" aria-hidden />
                فلزات اساسی:{' '}
                <span className={`num font-semibold ${changeClass(pulse?.flowBasicMetalsBillionToman ?? 0)}`}>
                  {fmtNum(pulse?.flowBasicMetalsBillionToman ?? 0, 1)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-[2px] w-4 rounded-full bg-[#0f766e]" aria-hidden />
                کانه‌های فلزی:{' '}
                <span className={`num font-semibold ${changeClass(pulse?.flowMetalOresBillionToman ?? 0)}`}>
                  {fmtNum(pulse?.flowMetalOresBillionToman ?? 0, 1)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-[2px] w-4 rounded-full bg-[#a16207]" aria-hidden />
                صندوق طلا:{' '}
                <span className={`num font-semibold ${changeClass(pulse?.flowGoldFundsBillionToman ?? 0)}`}>
                  {fmtNum(pulse?.flowGoldFundsBillionToman ?? 0, 1)}
                </span>
              </span>
              <span className="opacity-70">میلیارد تومان · TradersArena</span>
            </div>
            <TripleLineChart
              data={flowSeriesClean}
              series={[
                { key: 'stocks', label: 'سهام و حق‌تقدم', color: '#15803d' },
                { key: 'equityFunds', label: 'ص.سهامی', color: '#1a5f9e' },
                { key: 'fixedIncome', label: 'ص.درآمدثابت', color: '#b45309' },
                { key: 'basicMetals', label: 'فلزات اساسی', color: '#9a3412' },
                { key: 'metalOres', label: 'کانه‌های فلزی', color: '#0f766e' },
                { key: 'goldFunds', label: 'صندوق طلا', color: '#a16207' },
              ]}
              height={220}
              unit="میلیارد تومان"
            />
          </motion.div>
        </div>
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
  sourceHint,
}: {
  title: string
  pos: { symbol: string; impact: number }[]
  neg: { symbol: string; impact: number }[]
  live?: boolean
  sourceHint?: string
}) {
  const src =
    sourceHint?.includes('rahavard')
      ? 'رهاورد ۳۶۵ · تاثیر بر شاخص کل'
      : sourceHint?.includes('shakhesban')
        ? 'محاسبه از تابلو · قیمت پایانی'
        : live
          ? 'سورت تاثیر بر شاخص · زنده'
          : 'فعلاً از گزارش PDF — در انتظار داده زنده'
  return (
    <div className="panel p-4">
      <h3 className="mb-1 text-sm font-bold">{title}</h3>
      <p className="mb-3 text-[10px] text-[var(--color-muted)]">{src}</p>
      <div className="grid grid-cols-2 gap-3">
        <ul className="space-y-2">
          {(pos || []).slice(0, 5).map((s, i) => (
            <li key={`${s.symbol || 'p'}-${i}`} className="flex items-center justify-between text-sm">
              <span className="font-semibold">{s.symbol || '—'}</span>
              <span className="num pos">{fmtChange(s.impact)}</span>
            </li>
          ))}
          {!pos?.length ? <li className="text-[11px] text-[var(--color-muted)]">—</li> : null}
        </ul>
        <ul className="space-y-2">
          {(neg || []).slice(0, 5).map((s, i) => (
            <li key={`${s.symbol || 'n'}-${i}`} className="flex items-center justify-between text-sm">
              <span className="font-semibold">{s.symbol || '—'}</span>
              <span className="num neg">{fmtChange(s.impact)}</span>
            </li>
          ))}
          {!neg?.length ? <li className="text-[11px] text-[var(--color-muted)]">بدون تاثیر منفی معنادار</li> : null}
        </ul>
      </div>
    </div>
  )
}
