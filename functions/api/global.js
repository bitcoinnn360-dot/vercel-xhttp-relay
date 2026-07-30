/**
 * Cloudflare Pages Function: global mineral / materials market snapshot.
 *
 * GuruFocus blocks scrapers (Cloudflare). Equivalent public sources:
 *  - Yahoo Finance chart API → prices & period returns for ETFs / majors
 *  - Mining.com (+ Kitco) RSS → industry & macro headlines
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const UNIVERSE = [
  { symbol: 'SPY', name: 'S&P 500 ETF', nameFa: 'شاخص S&P ۵۰۰', group: 'شاخص‌ها', kind: 'etf' },
  { symbol: 'XLB', name: 'Materials Select Sector SPDR', nameFa: 'بخش مواد (XLB)', group: 'شاخص‌ها', kind: 'etf' },
  { symbol: 'XME', name: 'SPDR S&P Metals & Mining', nameFa: 'ETF فلزات و معادن', group: 'شاخص‌ها', kind: 'etf' },
  { symbol: 'PICK', name: 'iShares Global Metals & Mining', nameFa: 'ETF تولیدکنندگان فلز جهانی', group: 'شاخص‌ها', kind: 'etf' },
  { symbol: 'VALE', name: 'Vale S.A.', nameFa: 'واله (سنگ‌آهن)', group: 'سنگ‌آهن', kind: 'equity' },
  { symbol: 'BHP', name: 'BHP Group', nameFa: 'بی‌اچ‌پی', group: 'سنگ‌آهن', kind: 'equity' },
  { symbol: 'RIO', name: 'Rio Tinto', nameFa: 'ریوتینتو', group: 'سنگ‌آهن', kind: 'equity' },
  { symbol: 'SLX', name: 'VanEck Steel ETF', nameFa: 'ETF فولاد', group: 'فولاد', kind: 'etf' },
  { symbol: 'NUE', name: 'Nucor', nameFa: 'نوکور', group: 'فولاد', kind: 'equity' },
  { symbol: 'CLF', name: 'Cleveland-Cliffs', nameFa: 'کلیولند-کلیفس', group: 'فولاد', kind: 'equity' },
  { symbol: 'COPX', name: 'Global X Copper Miners', nameFa: 'ETF معدن‌کاران مس', group: 'مس', kind: 'etf' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', nameFa: 'فری‌پورت', group: 'مس', kind: 'equity' },
  { symbol: 'SCCO', name: 'Southern Copper', nameFa: 'ساوترن کاپر', group: 'مس', kind: 'equity' },
  { symbol: 'GDX', name: 'VanEck Gold Miners', nameFa: 'ETF معدن‌کاران طلا', group: 'فلزات گرانبها', kind: 'etf' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', nameFa: 'ETF طلا', group: 'فلزات گرانبها', kind: 'etf' },
  { symbol: 'AA', name: 'Alcoa', nameFa: 'آلکوا (آلومینیوم)', group: 'آلومینیوم', kind: 'equity' },
  { symbol: 'DBC', name: 'Invesco DB Commodity', nameFa: 'شاخص کالایی DBC', group: 'کامودیتی', kind: 'etf' },
  { symbol: 'USO', name: 'US Oil Fund', nameFa: 'ETF نفت', group: 'کامودیتی', kind: 'etf' },
]

const NEWS_FEEDS = [
  { url: 'https://www.mining.com/feed/', source: 'Mining.com', limit: 10 },
  { url: 'https://www.kitco.com/news/markets/rss', source: 'Kitco', limit: 6 },
  { url: 'https://www.federalreserve.gov/feeds/press_all.xml', source: 'Fed', limit: 4 },
]

function pct(from, to) {
  if (!(from > 0) || to == null || !Number.isFinite(to)) return null
  return Math.round((to / from - 1) * 10000) / 100
}

function strip(html) {
  return String(html || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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

async function yahooQuote(meta) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(meta.symbol)}?interval=1d&range=1y`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://finance.yahoo.com/' },
  })
  if (!res.ok) throw new Error(`yahoo ${meta.symbol} ${res.status}`)
  const j = await res.json()
  const r = j.chart?.result?.[0]
  const closes = r?.indicators?.quote?.[0]?.close || []
  const volumes = r?.indicators?.quote?.[0]?.volume || []
  const ts = r?.timestamp || []
  const valid = []
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] != null && Number.isFinite(closes[i])) {
      valid.push({ c: closes[i], v: volumes[i] || 0, t: ts[i] })
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

async function newsFromRss(url, source, limit = 8) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/rss+xml,application/xml,text/xml,*/*',
    },
    redirect: 'follow',
  })
  if (!res.ok) return []
  const xml = await res.text()
  const out = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const b = m[1]
    const title = strip((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1])
    const link = strip((b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1])
    const pubDate = strip((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1])
    const summary = strip((b.match(/<description>([\s\S]*?)<\/description>/i) || [])[1]).slice(0, 240)
    if (!title || !link) continue
    out.push({ title, titleFa: null, link, pubDate, summary, source })
    if (out.length >= limit) break
  }
  return out
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
    return {
      group: g,
      name: `صنعت ${g}`,
      nameFa: `صنعت ${g}`,
      isIndustry: true,
      dailyPct: avg('dailyPct'),
      weekPct: avg('weekPct'),
      monthPct: avg('monthPct'),
      ytdPct: avg('ytdPct'),
      count: members.length,
    }
  })
}

export async function onRequestGet(context) {
  const { request } = context
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=180',
    'access-control-allow-origin': '*',
  }

  let staticBundle = null
  try {
    const origin = new URL(request.url).origin
    const sres = await fetch(`${origin}/data/global_markets.json`, {
      cf: { cacheTtl: 0, cacheEverything: false },
    })
    if (sres.ok) staticBundle = await sres.json()
  } catch {
    /* ignore */
  }

  const wantFresh = new URL(request.url).searchParams.has('fresh')
  if (!wantFresh && staticBundle?.stocks?.length) {
    // Soft-serve static quickly; live scrape only on ?fresh=1
    return new Response(
      JSON.stringify({
        ...staticBundle,
        updatedAt: staticBundle.updatedAt || new Date().toISOString(),
        served: 'static-fast',
      }),
      { headers },
    )
  }

  const errors = []
  const stocks = []
  const batch = async (items, size, fn) => {
    for (let i = 0; i < items.length; i += size) {
      const part = await Promise.allSettled(items.slice(i, i + size).map(fn))
      part.forEach((r, j) => {
        if (r.status === 'fulfilled') stocks.push(r.value)
        else errors.push(`${items[i + j].symbol}: ${r.reason?.message || r.reason}`)
      })
    }
  }

  try {
    await withTimeout(batch(UNIVERSE, 6, (m) => yahooQuote(m)), 18000, 'yahoo-batch')
  } catch (e) {
    errors.push(String(e?.message || e))
  }

  let news = []
  try {
    const feeds = await Promise.all(
      NEWS_FEEDS.map((f) =>
        withTimeout(newsFromRss(f.url, f.source, f.limit), 6000, f.source).catch(() => []),
      ),
    )
    const seen = new Set()
    for (const list of feeds) {
      for (const item of list) {
        if (seen.has(item.link)) continue
        seen.add(item.link)
        news.push(item)
      }
    }
    news = news.slice(0, 18)
  } catch (e) {
    errors.push(`news: ${e?.message || e}`)
  }

  if (!stocks.length && staticBundle?.stocks?.length) {
    return new Response(
      JSON.stringify({
        ...staticBundle,
        ok: true,
        source: staticBundle.source || 'static',
        errors: errors.slice(0, 8),
        served: 'static-fallback',
      }),
      { headers },
    )
  }

  const industries = buildIndustries(stocks)
  const payload = {
    ok: stocks.length > 0,
    updatedAt: new Date().toISOString(),
    source: 'yahoo-finance+rss',
    note: 'GuruFocus با Cloudflare بسته است؛ معادل عمومی: Yahoo Finance + RSS خبری Mining/Kitco/Fed',
    stocks,
    industries,
    news: news.length ? news : staticBundle?.news || [],
    errors: errors.slice(0, 12),
  }
  return new Response(JSON.stringify(payload), { headers })
}
