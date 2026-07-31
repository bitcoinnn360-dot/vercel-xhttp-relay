import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
/**
 * Cloudflare Pages Function: global mineral / materials market snapshot.
 *
 * GuruFocus is Cloudflare-blocked. Public equivalents via Yahoo Finance:
 *  - Chart API → period returns (incl. 1Y / 3Y)
 *  - quoteSummary → margins, AUM / market-cap proxies
 *  - Select Sector SPDRs → aggregated Major Markets sector performance
 *  - Country materials ETFs → Basic Materials by country
 */

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

/** GICS sectors — Select Sector SPDR (aggregated major-market sector view). */
const GICS_SECTORS = [
  { symbol: 'XLB', name: 'Basic Materials', nameFa: 'مواد پایه' },
  { symbol: 'XLE', name: 'Energy', nameFa: 'انرژی' },
  { symbol: 'XLF', name: 'Financials', nameFa: 'مالی' },
  { symbol: 'XLI', name: 'Industrials', nameFa: 'صنعتی' },
  { symbol: 'XLK', name: 'Technology', nameFa: 'فناوری' },
  { symbol: 'XLP', name: 'Consumer Staples', nameFa: 'کالاهای مصرفی اساسی' },
  { symbol: 'XLU', name: 'Utilities', nameFa: 'خدمات عمومی' },
  { symbol: 'XLV', name: 'Health Care', nameFa: 'سلامت' },
  { symbol: 'XLY', name: 'Consumer Discretionary', nameFa: 'کالاهای مصرفی اختیاری' },
  { symbol: 'XLC', name: 'Communication Services', nameFa: 'ارتباطات' },
  { symbol: 'XLRE', name: 'Real Estate', nameFa: 'املاک' },
]

/**
 * صنایع داخل مواد پایه — هر صنعت از چند پروکسی کشوری/جهانی وزنی تجمیع می‌شود.
 * (معادل جزئیات Basic Materials در GuruFocus)
 */
const MATERIALS_INDUSTRIES = [
  {
    id: 'metals-mining',
    name: 'Metals & Mining',
    nameFa: 'فلزات و معادن',
    proxies: ['XME', 'PICK', 'XMA.TO', 'MVR.AX', 'EXV6.DE', '512400.SS'],
  },
  {
    id: 'steel',
    name: 'Steel',
    nameFa: 'فولاد',
    proxies: ['SLX'],
  },
  {
    id: 'copper',
    name: 'Copper',
    nameFa: 'مس',
    proxies: ['COPX'],
  },
  {
    id: 'gold',
    name: 'Gold Miners',
    nameFa: 'معدن‌کاران طلا',
    proxies: ['GDX'],
  },
  {
    id: 'chemicals',
    name: 'Chemicals',
    nameFa: 'شیمیایی',
    proxies: ['PYZ'],
  },
  {
    id: 'agriculture',
    name: 'Agriculture',
    nameFa: 'کشاورزی',
    proxies: ['MOO', 'VEGI'],
  },
  {
    id: 'lithium',
    name: 'Lithium & Battery',
    nameFa: 'لیتیوم و باتری',
    proxies: ['LIT'],
  },
  {
    id: 'rare-earth',
    name: 'Rare Earth / Strategic',
    nameFa: 'خاک نادر و استراتژیک',
    proxies: ['REMX'],
  },
]

/** فلزات و معادن به تفکیک کشور */
const METALS_MINING_BY_COUNTRY = [
  { country: 'United States', countryFa: 'آمریکا', symbol: 'XME' },
  { country: 'Canada', countryFa: 'کانادا', symbol: 'XMA.TO' },
  { country: 'Australia', countryFa: 'استرالیا', symbol: 'MVR.AX' },
  { country: 'Europe', countryFa: 'اروپا', symbol: 'EXV6.DE' },
  { country: 'China', countryFa: 'چین', symbol: '512400.SS' },
  { country: 'Global', countryFa: 'جهانی', symbol: 'PICK' },
  { country: 'Brazil', countryFa: 'برزیل', symbol: 'EWZ' },
  { country: 'Peru', countryFa: 'پرو', symbol: 'EPU' },
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

function pickNear(valid, targetTs) {
  let best = valid[0]
  for (const x of valid) {
    if (x.t >= targetTs) {
      best = x
      break
    }
  }
  return best
}

async function withTimeout(promise, ms, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function yahooAuth() {
  const fc = await fetch('https://fc.yahoo.com/', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  })
  const set = fc.headers.getSetCookie?.() || []
  const cookie = (set[0] || '').split(';')[0]
  if (!cookie) throw new Error('yahoo cookie missing')
  const cr = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
  })
  if (!cr.ok) throw new Error(`yahoo crumb ${cr.status}`)
  const crumb = (await cr.text()).trim()
  if (!crumb || crumb.length > 40) throw new Error('yahoo crumb invalid')
  return { cookie, crumb }
}

async function yahooQuote(meta) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(meta.symbol)}?interval=1d&range=5y`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://finance.yahoo.com/' },
  })
  if (!res.ok) throw new Error(`yahoo ${meta.symbol} ${res.status}`)
  const j = await res.json()
  const r = j.chart?.result?.[0]
  const closes = r?.indicators?.quote?.[0]?.close || []
  const adj = r?.indicators?.adjclose?.[0]?.adjclose || []
  const volumes = r?.indicators?.quote?.[0]?.volume || []
  const ts = r?.timestamp || []
  const valid = []
  for (let i = 0; i < closes.length; i++) {
    const px = adj[i] != null && Number.isFinite(adj[i]) ? adj[i] : closes[i]
    if (px != null && Number.isFinite(px)) {
      valid.push({ c: px, v: volumes[i] || 0, t: ts[i] })
    }
  }
  if (valid.length < 2) throw new Error(`${meta.symbol} thin history`)
  const last = valid[valid.length - 1]
  const prev = valid[valid.length - 2]
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
  const year1 = pickNear(valid, last.t - 365.25 * 24 * 3600)
  const year3 = pickNear(valid, last.t - 3 * 365.25 * 24 * 3600)
  return {
    ...meta,
    price: +last.c.toFixed(2),
    currency: r?.meta?.currency || 'USD',
    dailyPct: pct(prev.c, last.c),
    weekPct: pct(week.c, last.c),
    monthPct: pct(month.c, last.c),
    ytdPct: pct(ytd.c, last.c),
    year1Pct: pct(year1.c, last.c),
    year3Pct: pct(year3.c, last.c),
    volume: last.v || null,
    asOf: new Date(last.t * 1000).toISOString().slice(0, 10),
    source: 'yahoo-finance',
    returnsBasis: 'adjclose',
  }
}

async function yahooFundamentals(symbol, auth) {
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=financialData,defaultKeyStatistics,price,summaryDetail&crumb=${encodeURIComponent(auth.crumb)}`
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
  const price = row.price || {}
  const sd = row.summaryDetail || {}
  const aum = ks.totalAssets?.raw ?? sd.totalAssets?.raw ?? null
  const mcap =
    price.marketCap?.raw ??
    ks.enterpriseValue?.raw ??
    (price.regularMarketPrice?.raw && ks.sharesOutstanding?.raw
      ? price.regularMarketPrice.raw * ks.sharesOutstanding.raw
      : null)
  return {
    grossMarginPct: marginPct(fd.grossMargins),
    operatingMarginPct: marginPct(fd.operatingMargins),
    profitMarginPct: marginPct(fd.profitMargins),
    returnOnEquityPct: marginPct(fd.returnOnEquity),
    revenueGrowthPct: marginPct(fd.revenueGrowth),
    priceToBook: num(ks.priceToBook),
    marketCapUsd: mcap != null && Number.isFinite(mcap) ? Math.round(mcap) : null,
    aumUsd: aum != null && Number.isFinite(aum) ? Math.round(aum) : null,
  }
}

function weightOf(s) {
  const w = s.marketCapUsd || s.aumUsd
  return w != null && w > 0 ? w : 0
}

function weightedAvg(members, key) {
  let num = 0
  let den = 0
  let fallback = 0
  let n = 0
  for (const s of members) {
    const v = s[key]
    if (v == null || !Number.isFinite(v)) continue
    const w = weightOf(s)
    if (w > 0) {
      num += w * v
      den += w
    } else {
      fallback += v
      n += 1
    }
  }
  if (den > 0) return Math.round((num / den) * 100) / 100
  if (n > 0) return Math.round((fallback / n) * 100) / 100
  return null
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
    const eqs = members.filter((s) => s.kind === 'equity')
    return {
      group: g,
      name: `صنعت ${g}`,
      nameFa: `صنعت ${g}`,
      isIndustry: true,
      dailyPct: weightedAvg(members, 'dailyPct'),
      weekPct: weightedAvg(members, 'weekPct'),
      monthPct: weightedAvg(members, 'monthPct'),
      ytdPct: weightedAvg(members, 'ytdPct'),
      year1Pct: weightedAvg(members, 'year1Pct'),
      year3Pct: weightedAvg(members, 'year3Pct'),
      grossMarginPct: weightedAvg(eqs, 'grossMarginPct'),
      operatingMarginPct: weightedAvg(eqs, 'operatingMarginPct'),
      profitMarginPct: weightedAvg(eqs, 'profitMarginPct'),
      count: members.length,
    }
  })
}

function withWeights(rows) {
  const total = rows.reduce((a, r) => a + (r.marketCapUsd || r.aumUsd || 0), 0)
  return rows.map((r) => {
    const cap = r.marketCapUsd || r.aumUsd || null
    return {
      ...r,
      weightPct: total > 0 && cap ? Math.round((cap / total) * 10000) / 100 : null,
    }
  })
}

async function buildLiveBundle(errors) {
  const stocks = []
  const batch = async (items, size, fn, sink = stocks) => {
    for (let i = 0; i < items.length; i += size) {
      const part = await Promise.allSettled(items.slice(i, i + size).map(fn))
      part.forEach((r, j) => {
        if (r.status === 'fulfilled') sink.push(r.value)
        else errors.push(`${items[i + j].symbol}: ${r.reason?.message || r.reason}`)
      })
    }
  }

  await withTimeout(batch(UNIVERSE, 6, (m) => yahooQuote(m)), 28000, 'yahoo-batch')

  let auth = null
  try {
    auth = await withTimeout(yahooAuth(), 8000, 'yahoo-auth')
  } catch (e) {
    errors.push(`auth: ${e?.message || e}`)
  }

  const enrich = async (row) => {
    if (!auth) return row
    try {
      Object.assign(row, await yahooFundamentals(row.symbol, auth))
    } catch (e) {
      errors.push(`fund ${row.symbol}: ${e?.message || e}`)
    }
    return row
  }

  if (auth) {
    for (let i = 0; i < stocks.length; i += 4) {
      const slice = stocks.slice(i, i + 4)
      await Promise.all(slice.map((s) => enrich(s)))
    }
  }

  const quoteCache = new Map(stocks.map((s) => [s.symbol, s]))
  const ensureQuote = async (meta) => {
    if (quoteCache.has(meta.symbol)) return quoteCache.get(meta.symbol)
    const q = await yahooQuote(meta)
    if (auth) await enrich(q)
    quoteCache.set(meta.symbol, q)
    return q
  }

  const sectorPerformance = []
  for (const meta of GICS_SECTORS) {
    try {
      const q = await ensureQuote({ ...meta, group: 'gics', kind: 'etf', nameFa: meta.nameFa })
      sectorPerformance.push({
        symbol: meta.symbol,
        name: meta.name,
        nameFa: meta.nameFa,
        price: q.price,
        currency: q.currency,
        dailyPct: q.dailyPct,
        weekPct: q.weekPct,
        monthPct: q.monthPct,
        ytdPct: q.ytdPct,
        year1Pct: q.year1Pct,
        year3Pct: q.year3Pct,
        marketCapUsd: q.aumUsd || q.marketCapUsd || null,
        aumUsd: q.aumUsd || null,
        asOf: q.asOf,
      })
    } catch (e) {
      errors.push(`gics ${meta.symbol}: ${e?.message || e}`)
    }
  }

  const periodKeys = ['dailyPct', 'weekPct', 'monthPct', 'ytdPct', 'year1Pct', 'year3Pct']
  const materialsIndustries = []
  for (const ind of MATERIALS_INDUSTRIES) {
    const quotes = []
    for (const symbol of ind.proxies) {
      try {
        const q = await ensureQuote({
          symbol,
          name: ind.name,
          nameFa: ind.nameFa,
          group: 'materials-industry',
          kind: 'etf',
        })
        quotes.push(q)
      } catch (e) {
        errors.push(`mat-ind ${symbol}: ${e?.message || e}`)
      }
    }
    if (!quotes.length) continue
    const row = {
      id: ind.id,
      name: ind.name,
      nameFa: ind.nameFa,
      symbols: ind.proxies.filter((s) => quotes.some((q) => q.symbol === s)).join(' · '),
      marketCapUsd: quotes.reduce((a, q) => a + (q.aumUsd || q.marketCapUsd || 0), 0) || null,
      aumUsd: quotes.reduce((a, q) => a + (q.aumUsd || 0), 0) || null,
      asOf: quotes[0]?.asOf,
    }
    for (const key of periodKeys) {
      row[key] = weightedAvg(quotes, key)
    }
    materialsIndustries.push(row)
  }

  const metalsMiningByCountry = []
  for (const meta of METALS_MINING_BY_COUNTRY) {
    try {
      const q = await ensureQuote({
        symbol: meta.symbol,
        name: 'Metals & Mining',
        nameFa: 'فلزات و معادن',
        group: 'metals-country',
        kind: 'etf',
      })
      metalsMiningByCountry.push({
        country: meta.country,
        countryFa: meta.countryFa,
        sector: 'Metals & Mining',
        sectorFa: 'فلزات و معادن',
        symbol: meta.symbol,
        price: q.price,
        currency: q.currency,
        dailyPct: q.dailyPct,
        weekPct: q.weekPct,
        monthPct: q.monthPct,
        ytdPct: q.ytdPct,
        year1Pct: q.year1Pct,
        year3Pct: q.year3Pct,
        marketCapUsd: q.aumUsd || q.marketCapUsd || null,
        aumUsd: q.aumUsd || null,
        asOf: q.asOf,
      })
    } catch (e) {
      errors.push(`metals ${meta.symbol}: ${e?.message || e}`)
    }
  }

  return {
    ok: stocks.length > 0,
    updatedAt: new Date().toISOString(),
    source: 'yahoo-finance',
    note: 'بازدهی از adjclose یاهو · حاشیه TTM یاهو (با GF ممکن است فرق کند) · سکتور/صنایع وزنی',
    stocks,
    industries: buildIndustries(stocks),
    sectorPerformance: withWeights(sectorPerformance),
    materialsIndustries: withWeights(materialsIndustries),
    metalsMiningByCountry: withWeights(metalsMiningByCountry),
    materialsByCountry: withWeights(metalsMiningByCountry),
    countrySectors: [],
    news: [],
    errors: errors.slice(0, 20),
  }
}


const __dirname = dirname(fileURLToPath(import.meta.url))
const errors = []
const payload = await buildLiveBundle(errors)
const out = join(__dirname, '../public/data/global_markets.json')
writeFileSync(out, JSON.stringify(payload, null, 2))
console.log('wrote', out, {
  stocks: payload.stocks.length,
  sectors: payload.sectorPerformance?.length,
  industries: payload.materialsIndustries?.length,
  metals: payload.metalsMiningByCountry?.length,
  sampleInd: payload.materialsIndustries?.map(i=>[i.nameFa,i.ytdPct,i.year3Pct]),
  errors: errors.length
})
