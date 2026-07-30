#!/usr/bin/env node
/**
 * Generate public/data/global_markets.json (static-first snapshot).
 * Usage: node scripts/fetch_global.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const UNIVERSE = [
  { symbol: 'SPY', name: 'S&P 500 ETF', nameFa: 'شاخص S&P ۵۰۰', group: 'شاخص‌ها', kind: 'etf' },
  { symbol: 'XLB', name: 'Materials Select Sector', nameFa: 'بخش مواد آمریکا (XLB)', group: 'شاخص‌ها', kind: 'etf' },
  { symbol: 'XME', name: 'SPDR Metals & Mining', nameFa: 'فلزات و معادن آمریکا', group: 'شاخص‌ها', kind: 'etf' },
  { symbol: 'PICK', name: 'iShares Global Metals & Mining', nameFa: 'تولیدکنندگان فلز جهانی', group: 'شاخص‌ها', kind: 'etf' },
  { symbol: 'MXI', name: 'iShares Global Materials', nameFa: 'مواد پایه جهانی', group: 'شاخص‌ها', kind: 'etf' },
  { symbol: 'VALE', name: 'Vale', nameFa: 'واله', group: 'سنگ‌آهن', kind: 'equity' },
  { symbol: 'BHP', name: 'BHP Group', nameFa: 'بی‌اچ‌پی', group: 'سنگ‌آهن', kind: 'equity' },
  { symbol: 'RIO', name: 'Rio Tinto', nameFa: 'ریوتینتو', group: 'سنگ‌آهن', kind: 'equity' },
  { symbol: 'FMG.AX', name: 'Fortescue', nameFa: 'فورتسکیو', group: 'سنگ‌آهن', kind: 'equity' },
  { symbol: 'NGLOY', name: 'Anglo American', nameFa: 'آنگلو امریکن', group: 'سنگ‌آهن', kind: 'equity' },
  { symbol: 'SLX', name: 'VanEck Steel ETF', nameFa: 'ETF فولاد', group: 'فولاد', kind: 'etf' },
  { symbol: 'NUE', name: 'Nucor', nameFa: 'نوکور', group: 'فولاد', kind: 'equity' },
  { symbol: 'STLD', name: 'Steel Dynamics', nameFa: 'استیل داینامیکس', group: 'فولاد', kind: 'equity' },
  { symbol: 'CLF', name: 'Cleveland-Cliffs', nameFa: 'کلیولند-کلیفس', group: 'فولاد', kind: 'equity' },
  { symbol: 'MT', name: 'ArcelorMittal', nameFa: 'آرسلورمیتال', group: 'فولاد', kind: 'equity' },
  { symbol: 'PKX', name: 'POSCO', nameFa: 'پوسکو', group: 'فولاد', kind: 'equity' },
  { symbol: 'GGB', name: 'Gerdau', nameFa: 'گردائو', group: 'فولاد', kind: 'equity' },
  { symbol: 'COPX', name: 'Global X Copper Miners', nameFa: 'ETF معدن‌کاران مس', group: 'مس', kind: 'etf' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', nameFa: 'فری‌پورت', group: 'مس', kind: 'equity' },
  { symbol: 'SCCO', name: 'Southern Copper', nameFa: 'ساوترن کاپر', group: 'مس', kind: 'equity' },
  { symbol: 'TECK', name: 'Teck Resources', nameFa: 'تک ریسورسز', group: 'مس', kind: 'equity' },
  { symbol: 'HBM', name: 'Hudbay Minerals', nameFa: 'هادبِی', group: 'مس', kind: 'equity' },
  { symbol: 'FM.TO', name: 'First Quantum', nameFa: 'فرست کوانتوم', group: 'مس', kind: 'equity' },
  { symbol: 'ANTO.L', name: 'Antofagasta', nameFa: 'آنتوفاگاستا', group: 'مس', kind: 'equity' },
  { symbol: 'LUN.TO', name: 'Lundin Mining', nameFa: 'لوندین ماینینگ', group: 'مس', kind: 'equity' },
  { symbol: 'GDX', name: 'VanEck Gold Miners', nameFa: 'ETF معدن‌کاران طلا', group: 'فلزات گرانبها', kind: 'etf' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', nameFa: 'ETF طلا', group: 'فلزات گرانبها', kind: 'etf' },
  { symbol: 'NEM', name: 'Newmont', nameFa: 'نیومانت', group: 'فلزات گرانبها', kind: 'equity' },
  { symbol: 'AEM', name: 'Agnico Eagle', nameFa: 'اگنیکو ایگل', group: 'فلزات گرانبها', kind: 'equity' },
  { symbol: 'GOLD', name: 'Barrick Gold', nameFa: 'باریک گلد', group: 'فلزات گرانبها', kind: 'equity' },
  { symbol: 'WPM', name: 'Wheaton Precious Metals', nameFa: 'ویتون', group: 'فلزات گرانبها', kind: 'equity' },
  { symbol: 'PAAS', name: 'Pan American Silver', nameFa: 'پن‌آمریکن سیلور', group: 'فلزات گرانبها', kind: 'equity' },
  { symbol: 'AA', name: 'Alcoa', nameFa: 'آلکوا', group: 'آلومینیوم', kind: 'equity' },
  { symbol: 'CENX', name: 'Century Aluminum', nameFa: 'سنچری آلومینیوم', group: 'آلومینیوم', kind: 'equity' },
  { symbol: 'NHY.OL', name: 'Norsk Hydro', nameFa: 'نرسک هیدرو', group: 'آلومینیوم', kind: 'equity' },
  { symbol: 'DBC', name: 'Invesco DB Commodity', nameFa: 'شاخص کالایی DBC', group: 'کامودیتی', kind: 'etf' },
  { symbol: 'USO', name: 'US Oil Fund', nameFa: 'ETF نفت', group: 'کامودیتی', kind: 'etf' },
  { symbol: 'LIT', name: 'Global X Lithium & Battery', nameFa: 'ETF لیتیوم و باتری', group: 'کامودیتی', kind: 'etf' },
  { symbol: 'REMX', name: 'VanEck Rare Earth/Strategic', nameFa: 'ETF خاک نادر', group: 'کامودیتی', kind: 'etf' },
]

const COUNTRY_SECTORS = [
  { country: 'United States', countryFa: 'آمریکا', sector: 'Basic Materials', sectorFa: 'مواد پایه', symbol: 'XLB' },
  { country: 'United States', countryFa: 'آمریکا', sector: 'Metals & Mining', sectorFa: 'فلزات و معادن', symbol: 'XME' },
  { country: 'Canada', countryFa: 'کانادا', sector: 'Materials', sectorFa: 'مواد', symbol: 'XMA.TO' },
  { country: 'Australia', countryFa: 'استرالیا', sector: 'Resources', sectorFa: 'منابع معدنی', symbol: 'MVR.AX' },
  { country: 'Europe', countryFa: 'اروپا', sector: 'Basic Resources', sectorFa: 'منابع پایه', symbol: 'EXV6.DE' },
  { country: 'China', countryFa: 'چین', sector: 'Basic Materials', sectorFa: 'مواد پایه', symbol: '512400.SS' },
  { country: 'Global', countryFa: 'جهانی', sector: 'Materials', sectorFa: 'مواد پایه', symbol: 'MXI' },
  { country: 'Global', countryFa: 'جهانی', sector: 'Metals & Mining', sectorFa: 'فلزات و معادن', symbol: 'PICK' },
  { country: 'Global', countryFa: 'جهانی', sector: 'Copper Miners', sectorFa: 'معدن‌کاران مس', symbol: 'COPX' },
  { country: 'Global', countryFa: 'جهانی', sector: 'Steel', sectorFa: 'فولاد', symbol: 'SLX' },
  { country: 'Global', countryFa: 'جهانی', sector: 'Gold Miners', sectorFa: 'معدن‌کاران طلا', symbol: 'GDX' },
  { country: 'Brazil', countryFa: 'برزیل', sector: 'Broad (materials-heavy)', sectorFa: 'بازار گسترده (موادمحور)', symbol: 'EWZ' },
  { country: 'Peru', countryFa: 'پرو', sector: 'Broad (mining-heavy)', sectorFa: 'بازار گسترده (معدن‌محور)', symbol: 'EPU' },
]

function pct(from, to) {
  if (!(from > 0) || to == null || !Number.isFinite(to)) return null
  return Math.round((to / from - 1) * 10000) / 100
}
function marginPct(raw) {
  const v = raw?.raw ?? raw
  if (v == null || !Number.isFinite(v)) return null
  return Math.round(v * 10000) / 100
}
function num(raw) {
  const v = raw?.raw ?? raw
  if (v == null || !Number.isFinite(v)) return null
  return Math.round(v * 100) / 100
}

async function yahooAuth() {
  const fc = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual' })
  const set = fc.headers.getSetCookie?.() || []
  const cookie = (set[0] || '').split(';')[0]
  if (!cookie) throw new Error('cookie missing')
  const cr = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
  })
  const crumb = (await cr.text()).trim()
  return { cookie, crumb }
}

async function yahooQuote(meta) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(meta.symbol)}?interval=1d&range=1y`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://finance.yahoo.com/' },
  })
  if (!res.ok) throw new Error(`${meta.symbol} ${res.status}`)
  const j = await res.json()
  const r = j.chart?.result?.[0]
  const closes = r?.indicators?.quote?.[0]?.close || []
  const volumes = r?.indicators?.quote?.[0]?.volume || []
  const ts = r?.timestamp || []
  const valid = []
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] != null && Number.isFinite(closes[i])) valid.push({ c: closes[i], v: volumes[i] || 0, t: ts[i] })
  }
  if (valid.length < 2) throw new Error(`${meta.symbol} thin`)
  const last = valid.at(-1)
  const prev = valid.at(-2)
  const week = valid[Math.max(0, valid.length - 6)]
  const month = valid[Math.max(0, valid.length - 22)]
  const year = new Date(last.t * 1000).getUTCFullYear()
  let ytd = valid[0]
  for (const x of valid) {
    if (new Date(x.t * 1000).getUTCFullYear() === year) {
      ytd = x
      break
    }
  }
  return {
    ...meta,
    price: +last.c.toFixed(2),
    currency: r?.meta?.currency || 'USD',
    dailyPct: pct(prev.c, last.c),
    weekPct: pct(week.c, last.c),
    monthPct: pct(month.c, last.c),
    ytdPct: pct(ytd.c, last.c),
    volume: last.v || null,
    asOf: new Date(last.t * 1000).toISOString().slice(0, 10),
    source: 'yahoo-finance',
  }
}

async function yahooFundamentals(symbol, auth) {
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=financialData,defaultKeyStatistics&crumb=${encodeURIComponent(auth.crumb)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Cookie: auth.cookie,
      Accept: 'application/json',
      Referer: 'https://finance.yahoo.com/',
    },
  })
  if (!res.ok) throw new Error(`fund ${symbol} ${res.status}`)
  const j = await res.json()
  const row = j?.quoteSummary?.result?.[0] || {}
  const fd = row.financialData || {}
  const ks = row.defaultKeyStatistics || {}
  return {
    grossMarginPct: marginPct(fd.grossMargins),
    operatingMarginPct: marginPct(fd.operatingMargins),
    profitMarginPct: marginPct(fd.profitMargins),
    returnOnEquityPct: marginPct(fd.returnOnEquity),
    revenueGrowthPct: marginPct(fd.revenueGrowth),
    priceToBook: num(ks.priceToBook),
  }
}

function buildIndustries(stocks) {
  const groups = []
  const seen = new Set()
  for (const s of stocks) {
    if (!s.group || seen.has(s.group)) continue
    seen.add(s.group)
    groups.push(s.group)
  }
  return groups.map((g) => {
    const members = stocks.filter((s) => s.group === g)
    const avg = (key) => {
      let n = 0
      let d = 0
      for (const s of members) {
        const v = s[key]
        if (v != null && Number.isFinite(v)) {
          n += v
          d += 1
        }
      }
      return d ? Math.round((n / d) * 100) / 100 : 0
    }
    const marginAvg = (key) => {
      const eqs = members.filter((s) => s.kind === 'equity')
      let n = 0
      let d = 0
      for (const s of eqs) {
        const v = s[key]
        if (v != null && Number.isFinite(v)) {
          n += v
          d += 1
        }
      }
      return d ? Math.round((n / d) * 100) / 100 : null
    }
    return {
      group: g,
      name: `صنعت ${g}`,
      nameFa: `صنعت ${g}`,
      isIndustry: true,
      dailyPct: avg('dailyPct'),
      weekPct: avg('weekPct'),
      monthPct: avg('monthPct'),
      ytdPct: avg('ytdPct'),
      grossMarginPct: marginAvg('grossMarginPct'),
      profitMarginPct: marginAvg('profitMarginPct'),
      count: members.length,
    }
  })
}

async function batch(items, size, fn, out, errors) {
  for (let i = 0; i < items.length; i += size) {
    const part = await Promise.allSettled(items.slice(i, i + size).map(fn))
    part.forEach((r, j) => {
      if (r.status === 'fulfilled') out.push(r.value)
      else errors.push(`${items[i + j].symbol}: ${r.reason?.message || r.reason}`)
    })
  }
}

const errors = []
const stocks = []
console.log('fetching quotes…')
await batch(UNIVERSE, 6, yahooQuote, stocks, errors)
console.log('quotes', stocks.length, 'errors', errors.length)

let auth
try {
  auth = await yahooAuth()
  console.log('auth ok')
} catch (e) {
  console.warn('auth fail', e.message)
}

if (auth) {
  const equities = stocks.filter((s) => s.kind === 'equity')
  console.log('fundamentals', equities.length)
  for (let i = 0; i < equities.length; i += 4) {
    const slice = equities.slice(i, i + 4)
    await Promise.all(
      slice.map(async (s) => {
        try {
          Object.assign(s, await yahooFundamentals(s.symbol, auth))
        } catch (e) {
          errors.push(`fund ${s.symbol}: ${e.message}`)
        }
      }),
    )
  }
}

const countrySectors = []
const seen = new Map(stocks.map((s) => [s.symbol, s]))
for (const meta of COUNTRY_SECTORS) {
  try {
    let q = seen.get(meta.symbol)
    if (!q) {
      q = await yahooQuote({
        symbol: meta.symbol,
        name: meta.sector,
        nameFa: meta.sectorFa,
        group: 'country-sector',
        kind: 'etf',
      })
    }
    countrySectors.push({
      ...meta,
      price: q.price,
      currency: q.currency,
      dailyPct: q.dailyPct,
      weekPct: q.weekPct,
      monthPct: q.monthPct,
      ytdPct: q.ytdPct,
      asOf: q.asOf,
    })
  } catch (e) {
    errors.push(`sector ${meta.symbol}: ${e.message}`)
  }
}

const payload = {
  ok: stocks.length > 0,
  updatedAt: new Date().toISOString(),
  source: 'yahoo-finance',
  note: 'GuruFocus بسته است؛ قیمت و حاشیه سود از Yahoo · عملکرد سکتور کشورها با ETFهای مواد/معادن',
  stocks,
  industries: buildIndustries(stocks),
  countrySectors,
  news: [],
  errors: errors.slice(0, 20),
}

const out = join(root, 'public/data/global_markets.json')
writeFileSync(out, JSON.stringify(payload, null, 2))
console.log('wrote', out, 'stocks', stocks.length, 'sectors', countrySectors.length, 'withMargins', stocks.filter((s) => s.profitMarginPct != null).length)
if (errors.length) console.log('sample errors', errors.slice(0, 8))
