export type ChangeDir = 'up' | 'down' | 'flat'

export interface Metric {
  label: string
  value: number
  unit?: string
  change?: number
  changePct?: number
  prevValue?: number
}

export interface IndexSnapshot {
  name: string
  value: number
  change: number
  changePct: number
  marketValueHmt?: number
}

export interface CandlePoint {
  date: string
  dateJalali?: string
  open: number
  high: number
  low: number
  close: number
}

export interface MarketOverview {
  dateJalali: string
  dateGregorian: string
  tedpix: IndexSnapshot
  equalWeight: IndexSnapshot
  ifb: IndexSnapshot
  totalMarketValueHmt: number
  totalMarketValueUsdM: number
  usdRate: number
  totalTradeValueHmt: number
  retailTradeValueHmt: number
  retailMoneyFlowYtd: number
  /** برآورد خالص ورود/خروج پول حقیقی امروز (میلیارد تومان) */
  retailMoneyFlowDaily?: number
  /** ارزش معاملات خرد سهام+صندوق+حق تقدم (میلیارد تومان) از پارسیس */
  retailTradeValueBillionToman?: number
  indexHistory: { date: string; value: number }[]
  intradayIndex: { time: string; value: number }[]
  moneyFlowSeries: { date: string; value: number }[]
  candles1401?: CandlePoint[]
  liveNotes?: string[]
  dataSource?: 'live' | 'seed'
  fieldSources?: Record<string, string>
  blockedSources?: string[]
  impactsLive?: boolean
  marketPulse?: MarketPulseSnapshot | null
  marketPulseHistory?: MarketPulsePoint[]
}

export interface MarketPulsePoint {
  time: string
  positive?: number
  negative?: number
  flat?: number
  orderBuy?: number
  orderSell?: number
  retailFlow?: number
  flowStocks?: number
  flowEquityFunds?: number
  flowFixedIncome?: number
  flowBasicMetals?: number
  flowMetalOres?: number
  flowGoldFunds?: number
  perCapitaBuy?: number
  perCapitaSell?: number
}

export interface MarketPulseSnapshot {
  asOf?: string
  time?: string
  dateJalali?: string
  source?: string
  breadth?: { positive: number; negative: number; flat: number; total: number }
  orderBuyBillionToman?: number
  orderSellBillionToman?: number
  retailMoneyFlowBillionToman?: number
  flowStocksBillionToman?: number
  flowEquityFundsBillionToman?: number
  flowFixedIncomeBillionToman?: number
  flowBasicMetalsBillionToman?: number
  flowMetalOresBillionToman?: number
  flowGoldFundsBillionToman?: number
  retailBuyBillionToman?: number
  retailSellBillionToman?: number
  perCapitaBuyMillionToman?: number | null
  perCapitaSellMillionToman?: number | null
  note?: string
}

export interface ImpactStock {
  symbol: string
  impact: number
}

export interface StockRow {
  group: string
  name: string
  /** نماد تابلو (برای سهام، نه ردیف صنعت) */
  symbol?: string
  marketValueBr: number
  marketValueUsdM: number
  volume: number
  tradeValueMr: number
  closePrice: number
  dailyPct: number
  ytdPct: number
  monthPct: number
  weekPct: number
  isIndustry?: boolean
  /** بازدهی از قیمت تعدیل‌شده (افزایش سرمایه / سود تقسیمی) */
  returnsAdjusted?: boolean
  returnsSource?: string
  /** خالص خرید حقیقی امروز — میلیارد تومان (بورس‌ویو) */
  netIndividualBt?: number
  /** آخرین ۷ روز معاملاتی خالص حقیقی — میلیارد تومان (قدیمی→جدید) */
  netIndividualWeekBt?: number[]
  /** درصد شناوری از بورس‌ویو */
  freeFloatPct?: number
  outstandingShares?: number
  /** نسبت حجم معاملات امروز به سهام شناور — درصد */
  volumeToFloatPct?: number
  halted?: boolean
}

export interface PortfolioHolding {
  symbol: string
  capitalMr: number
  ownershipPct: number
  portfolioPct: number
  costMr: number
  marketValueMr: number
  costPerShare: number
  pricePerShare: number
  unrealizedMr: number
  /** تعداد سهام تحت تملک (در صورت محاسبه زنده) */
  shares?: number
  outstandingShares?: number
  ownershipSource?: string
  live?: boolean
  static?: boolean
  asOf?: string | number | null
}

export interface NavSummary {
  listedPremiumMr: number
  unlistedPremiumMr: number
  impairmentReserveMr: number
  realEstatePremiumMr: number
  equityMr: number
  navMr: number
  capitalMr: number
  navPerShare: number
  sharePrice: number
  pNavPct: number
  prev: {
    listedPremiumMr: number
    navMr: number
    navPerShare: number
    sharePrice: number
    pNavPct: number
  }
}

export interface CommodityQuote {
  id: string
  name: string
  value: number
  unit: string
  change: number
  changePct: number
  source: 'tgju' | 'seed' | 'manual'
  lastTradeJalali?: string
  history?: { t: string; v: number }[]
}

export interface SteelQuote {
  id: string
  name: string
  nameFa: string
  value: number
  unit: string
  change: number
  changePct: number
  region: 'china' | 'iran' | 'global'
  asOf?: string
  source?: string
  basis?: string
  history?: { t: string; v: number }[]
}

export interface ImeSteelRow {
  product: string
  priceRialKg: number
  ratioToBilletPct: number
  tradeDate: string
  source?: string
  samples?: number
}

export interface PeriodicRow {
  name: string
  price: number
  unit: string
  dailyPct?: number
  weeklyPct: number
  monthlyPct: number
  yoyPct: number
  group: 'steel' | 'macro'
}

/** نماد/ETF بازار جهانی (معادل صنایع معدنی داخلی) — Yahoo Finance */
export interface GlobalMarketRow {
  symbol: string
  name: string
  nameFa: string
  group: string
  kind?: 'etf' | 'equity' | 'index'
  price?: number | null
  currency?: string
  dailyPct?: number | null
  weekPct?: number | null
  monthPct?: number | null
  ytdPct?: number | null
  volume?: number | null
  asOf?: string
  source?: string
  isIndustry?: boolean
  count?: number
  /** حاشیه سود ناخالص % */
  grossMarginPct?: number | null
  /** حاشیه عملیاتی % */
  operatingMarginPct?: number | null
  /** حاشیه سود خالص % */
  profitMarginPct?: number | null
  returnOnEquityPct?: number | null
  revenueGrowthPct?: number | null
  priceToBook?: number | null
}

/** عملکرد سکتور/صنعت در کشورها (پروکسی ETF — شبیه GuruFocus Sector Performance) */
export interface CountrySectorRow {
  country: string
  countryFa: string
  sector: string
  sectorFa: string
  symbol: string
  price?: number | null
  currency?: string
  dailyPct?: number | null
  weekPct?: number | null
  monthPct?: number | null
  ytdPct?: number | null
  asOf?: string
}

export interface GlobalNewsItem {
  title: string
  titleFa?: string | null
  link: string
  pubDate?: string
  summary?: string
  source: string
}

export interface GlobalMarketsBundle {
  stocks: GlobalMarketRow[]
  industries: GlobalMarketRow[]
  countrySectors?: CountrySectorRow[]
  news?: GlobalNewsItem[]
  updatedAt?: string
  source?: string
  note?: string
  served?: string
}

export interface SourceStatus {
  id: string
  name: string
  status: 'live' | 'seed' | 'blocked' | 'error'
  note: string
  lastOk?: string
}

export interface DashboardData {
  overview: MarketOverview
  impacts: { boursePos: ImpactStock[]; bourseNeg: ImpactStock[]; ifbPos: ImpactStock[]; ifbNeg: ImpactStock[] }
  topTrades: { name: string; valueBr: number }[]
  stocks: StockRow[]
  holdings: PortfolioHolding[]
  nav: NavSummary
  commodities: CommodityQuote[]
  steel: SteelQuote[]
  imeChain: ImeSteelRow[]
  inventories: { label: string; value: number; wowChange: number; asOf?: string }
  bfRate: {
    rate: number
    wowChangePct: number
    asOf?: string
    published?: string
    capacityRate?: number
    note?: string
    source?: string
  }
  billetStocks?: { label: string; value: number; wowChange: number; asOf?: string }
  periodic: PeriodicRow[]
  /** صنایع معدنی/مواد جهانی + اخبار (معادل GuruFocus؛ منبع Yahoo + RSS) */
  globalMarkets: GlobalMarketsBundle
  sources: SourceStatus[]
  updatedAt: string
}
