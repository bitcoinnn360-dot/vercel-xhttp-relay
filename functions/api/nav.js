/**
 * Live Midco NAV from BourseView prices + outstanding shares.
 *
 * Ownership % comes from the latest daily-report baseline (PDF). BourseView's
 * /shareholders endpoint is currently broken server-side
 * (`ShareholderRepo.get_shareholders`), so we cannot refresh ownership live yet.
 *
 * marketValueMr = sharesOwned × vwap / 1e6
 * costPerShare  = costMr × 1e6 / sharesOwned
 * unrealizedMr  = marketValueMr − costMr
 * portfolioPct  = marketValueMr / Σ marketValue × 100
 * navPerShare   = navMr × 1000 / midcoCapitalMr   (par 1000 rial)
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BV_BASE = 'https://www.bourseview.com'

/** Static cost / ownership baseline from Midco daily report (PDF). */
const HOLDINGS = [
  { symbol: 'کگل', isin: 'IRO1GOLG0001', exchange: 'IRTSENO', ownershipPct: 22.69, costMr: 88_573_432 },
  { symbol: 'کچاد', isin: 'IRO1CHML0001', exchange: 'IRTSENO', ownershipPct: 15.79, costMr: 46_586_910 },
  { symbol: 'کگهر', isin: 'IRO3GZIZ0001', exchange: 'IRIFBNO', ownershipPct: 17.7, costMr: 26_858_546 },
  { symbol: 'کنور', isin: 'IRO1KNRZ0001', exchange: 'IRTSENO', ownershipPct: 83.1, costMr: 57_457_439 },
  // فملی: سهم‌های تحت تملک بعد از افزایش سرمایه؛ قیمت دیگر توسط بورس تعدیل شده — بدون scale دستی
  { symbol: 'فملی', isin: 'IRO1MSMI0001', exchange: 'IRTSENO', ownershipPct: 4.968657866190476, ownedShares: 71_548_673_273, costMr: 10_744_777 },
  { symbol: 'ارفع', isin: 'IRO3ARFZ0001', exchange: 'IRIFBNO', ownershipPct: 20.96, costMr: 6_066_330 },
  { symbol: 'تجلی', isin: 'IRO3TMMZ0001', exchange: 'IRIFBNO', ownershipPct: 53.4, costMr: 66_565_604 },
  { symbol: 'فخاس', isin: 'IRO1FKAS0001', exchange: 'IRTSENO', ownershipPct: 33.4, costMr: 10_944_380 },
  { symbol: 'بکام', isin: 'IRO1KGND0001', exchange: 'IRTSENO', ownershipPct: 77.1, costMr: 7_604_465 },
  { symbol: 'انرژی', isin: 'IRO1BENC0001', exchange: 'IRTSENO', ownershipPct: 2.5, costMr: 145_547 },
  { symbol: 'بورس', isin: 'IRO1BORS0001', exchange: 'IRTSENO', ownershipPct: 1.0, costMr: 1_500 },
  { symbol: 'کالا', isin: 'IRO1KALA0001', exchange: 'IRTSENO', ownershipPct: 0.8, costMr: 827 },
  { symbol: 'فلات', isin: 'IRO7FLTP0001', exchange: 'IRIFBOTC', ownershipPct: 6.8, costMr: 68_089 },
  { symbol: 'فرابورس', isin: 'IRO3FRBZ0001', exchange: 'IRIFBNO', ownershipPct: 0.33, costMr: 587_363 },
]

/** Manual / other securities — user updates cost & MV periodically. */
const OTHER_PAPERS = {
  symbol: 'سایر اوراق',
  ownershipPct: 0,
  costMr: 7_914_440,
  marketValueMr: 11_973_636,
  capitalMr: 0,
  shares: 0,
  costPerShare: 0,
  pricePerShare: 0,
  static: true,
}

const MIDCO = { symbol: 'ومعادن', isin: 'IRO1MADN0001', exchange: 'IRTSENO' }

/** Non-listed NAV components from latest PDF (million rial). */
const NAV_STATIC = {
  unlistedPremiumMr: 704_636_883,
  impairmentReserveMr: 0,
  realEstatePremiumMr: 28_652_760,
  equityMr: 746_140_889,
  capitalMr: 570_000_000,
  prev: {
    listedPremiumMr: 2_007_342_520,
    navMr: 3_486_773_052,
    navPerShare: 6117,
    sharePrice: 2030,
    pNavPct: 33.2,
  },
}

const CACHE_TTL_MS = 2 * 60 * 1000
const CACHE_KEY = 'https://cache.local/midco-nav-bv-v6'

function normalizeCookie(raw) {
  let c = String(raw || '').trim()
  if (!c) return ''
  if (!/authentication=/i.test(c) && !/;/.test(c) && c.length > 20) {
    c = `authentication=${c}`
  }
  return c
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10
}

function round0(n) {
  return Math.round(Number(n))
}

async function bvJson(cookie, path, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BV_BASE}${path}`, {
        headers: {
          Cookie: cookie,
          Accept: 'application/json',
          'User-Agent': UA,
          Referer: 'https://www.bourseview.com/',
          Origin: 'https://www.bourseview.com',
        },
        redirect: 'follow',
      })
      if (res.status === 403 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1) + Math.floor(Math.random() * 300)))
        lastErr = new Error(`bourseview ${res.status} ${path}`)
        continue
      }
      if (!res.ok) throw new Error(`bourseview ${res.status} ${path}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 250 * (i + 1)))
    }
  }
  throw lastErr || new Error(`bourseview failed ${path}`)
}

async function fetchStockMeta(cookie, exchange, isin, symbol = '') {
  const [meta, quotes] = await Promise.all([
    bvJson(cookie, `/api/v2/exchanges/${exchange}/stocks/${isin}`),
    bvJson(
      cookie,
      `/api/v2/exchanges/${exchange}/stocks/${isin}/quotes?timeFrame=daily&lastN=3&expand=shamsiDate`,
    ),
  ])
  const items = Array.isArray(quotes?.items) ? [...quotes.items] : []
  // Prefer newest session with a usable price (vwap first — close is often null post CI).
  items.sort((a, b) => Number(b?.date || 0) - Number(a?.date || 0))
  const last =
    items.find((r) => {
      const v = Number(r?.vwap)
      const c = Number(r?.close)
      return (Number.isFinite(v) && v > 0) || (Number.isFinite(c) && c > 0)
    }) || items[0] || {}
  let outstanding =
    Number(meta?.numberOfOutstandingShares) || Number(last?.numberOfOutstandingShares) || null
  // Capital-increase filings can land on stock meta before quote history catches up.
  const shareOverrides = { فملی: 1_440_000_000_000 }
  if (symbol && shareOverrides[symbol]) outstanding = shareOverrides[symbol]
  const vwap = Number(last?.vwap)
  const close = Number(last?.close)
  const price = Number.isFinite(vwap) && vwap > 0 ? vwap : Number.isFinite(close) && close > 0 ? close : null
  return {
    outstanding,
    price,
    capitalMr: outstanding != null ? outstanding / 1000 : null, // par 1000 rial → million rial
    asOf: last?.shamsiDate || last?.date || null,
  }
}

/** Best-effort ownership from BV (currently broken — returns null). */
async function tryFetchOwnershipPct(cookie, exchange, isin, holderNeedles) {
  try {
    const data = await bvJson(cookie, `/api/v2/exchanges/${exchange}/stocks/${isin}/shareholders`)
    const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
    for (const row of rows) {
      const name = String(row?.name || row?.shareholderName || row?.nameFa || '')
      if (!holderNeedles.some((n) => name.includes(n))) continue
      const pct = Number(row?.percent || row?.percentage || row?.ownershipPercent)
      if (Number.isFinite(pct) && pct > 0) return pct
    }
  } catch {
    /* endpoint broken or unauthorized */
  }
  return null
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return out
}

function buildHoldings(liveRows) {
  const rows = []
  for (const r of liveRows) {
    if (!r) continue
    rows.push(r)
  }
  const other = {
    ...OTHER_PAPERS,
    unrealizedMr: OTHER_PAPERS.marketValueMr - OTHER_PAPERS.costMr,
    portfolioPct: 0,
  }
  rows.push(other)

  const totalMv = rows.reduce((s, h) => s + (Number(h.marketValueMr) || 0), 0) || 1
  for (const h of rows) {
    h.portfolioPct = round1(((Number(h.marketValueMr) || 0) / totalMv) * 100)
  }
  return rows
}

export async function onRequestGet(context) {
  const { request, env } = context
  const forceRefresh = new URL(request.url).searchParams.has('fresh') || new URL(request.url).searchParams.has('refresh')
  const cookie = normalizeCookie(env?.BOURSEVIEW_COOKIE || env?.BOURSEVIEW_TOKEN || '')

  const cache = typeof caches !== 'undefined' ? caches.default : null
  if (cache && !forceRefresh) {
    const hit = await cache.match(CACHE_KEY)
    if (hit) return hit
  }

  if (!cookie) {
    return Response.json(
      { ok: false, error: 'BOURSEVIEW_COOKIE missing', source: 'bourseview' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  const errors = []

  // Sequential + short pause: parallel bursts from CF IPs often get BV 403.
  // Skip /shareholders (broken endpoint) to cut request volume in half.
  const liveRows = await mapPool(HOLDINGS, 1, async (h) => {
    try {
      await new Promise((r) => setTimeout(r, 180))
      const meta = await fetchStockMeta(cookie, h.exchange, h.isin, h.symbol)
      const liveOwn = null
      const outstanding = meta.outstanding
      if (!outstanding || !meta.price) throw new Error('missing outstanding/price')
      // Prefer explicit post-capital-increase share count (e.g. فملی 52.17B → 71.55B).
      const shares =
        h.ownedShares != null
          ? Math.round(h.ownedShares)
          : Math.round(outstanding * ((liveOwn != null ? liveOwn : h.ownershipPct) / 100))
      const ownershipPct =
        liveOwn != null
          ? liveOwn
          : Math.round((shares / outstanding) * 1e6) / 1e4
      // Use exchange price as-is (TSETMC/BV already adjust for capital increases).
      const price = meta.price
      const marketValueMr = round0((shares * price) / 1e6)
      const costPerShare = shares > 0 ? round0((h.costMr * 1e6) / shares) : 0
      return {
        symbol: h.symbol,
        isin: h.isin,
        capitalMr: round0(meta.capitalMr ?? outstanding / 1000),
        outstandingShares: outstanding,
        shares,
        ownershipPct,
        ownershipSource: liveOwn != null ? 'bourseview' : h.ownedShares != null ? 'scaled-capital-increase' : 'pdf-baseline',
        costMr: h.costMr,
        marketValueMr,
        costPerShare,
        pricePerShare: round0(price),
        unrealizedMr: marketValueMr - h.costMr,
        portfolioPct: 0,
        asOf: meta.asOf,
        live: true,
      }
    } catch (e) {
      errors.push(`${h.symbol}: ${e}`)
      return null
    }
  })

  let midcoPrice = null
  let midcoOutstanding = null
  try {
    const m = await fetchStockMeta(cookie, MIDCO.exchange, MIDCO.isin)
    midcoPrice = m.price
    midcoOutstanding = m.outstanding
  } catch (e) {
    errors.push(`ومعادن: ${e}`)
  }

  const holdings = buildHoldings(liveRows.filter(Boolean))
  const listedPremiumMr = holdings.reduce((s, h) => s + (Number(h.unrealizedMr) || 0), 0)
  const capitalMr = NAV_STATIC.capitalMr
  const navMr = round0(
    listedPremiumMr +
      NAV_STATIC.unlistedPremiumMr +
      NAV_STATIC.impairmentReserveMr +
      NAV_STATIC.realEstatePremiumMr +
      NAV_STATIC.equityMr,
  )
  const navPerShare = capitalMr > 0 ? round0((navMr * 1000) / capitalMr) : null
  const sharePrice = midcoPrice != null ? round0(midcoPrice) : null
  const pNavPct =
    navPerShare && sharePrice != null ? Math.round((sharePrice / navPerShare) * 1000) / 10 : null

  const body = {
    ok: holdings.filter((h) => h.live).length >= 8,
    updatedAt: new Date().toISOString(),
    source: 'bourseview+pdf-baseline',
    ownershipNote:
      'درصد مالکیت از آخرین گزارش روزانه؛ endpoint سهامداران بورس‌ویو فعلاً خراب است',
    holdings,
    nav: {
      listedPremiumMr: round0(listedPremiumMr),
      unlistedPremiumMr: NAV_STATIC.unlistedPremiumMr,
      impairmentReserveMr: NAV_STATIC.impairmentReserveMr,
      realEstatePremiumMr: NAV_STATIC.realEstatePremiumMr,
      equityMr: NAV_STATIC.equityMr,
      navMr,
      capitalMr,
      navPerShare,
      sharePrice,
      pNavPct,
      prev: NAV_STATIC.prev,
      midcoOutstandingShares: midcoOutstanding,
    },
    liveCount: holdings.filter((h) => h.live).length,
    errors: errors.slice(0, 12),
  }

  const headers = {
    'cache-control': 'public, max-age=120',
    'access-control-allow-origin': '*',
    'content-type': 'application/json; charset=utf-8',
  }
  const payload = JSON.stringify(body)
  if (cache && body.ok) {
    try {
      const cached = new Response(payload, {
        headers: { ...headers, 'cache-control': `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}` },
      })
      context.waitUntil(cache.put(CACHE_KEY, cached.clone()))
    } catch {
      /* ignore cache write */
    }
  }
  return new Response(payload, { headers })
}
