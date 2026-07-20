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
  indexHistory: { date: string; value: number }[]
  intradayIndex: { time: string; value: number }[]
  moneyFlowSeries: { date: string; value: number }[]
}

export interface ImpactStock {
  symbol: string
  impact: number
}

export interface StockRow {
  group: string
  name: string
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
}

export interface ImeSteelRow {
  product: string
  priceRialKg: number
  ratioToBilletPct: number
  tradeDate: string
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
  periodic: PeriodicRow[]
  sources: SourceStatus[]
  updatedAt: string
}
