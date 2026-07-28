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
  inventories: { label: string; value: number; wowChange: number }
  bfRate: { rate: number; wowChangePct: number }
  billetStocks?: { label: string; value: number; wowChange: number }
  periodic: PeriodicRow[]
  sources: SourceStatus[]
  updatedAt: string
}
