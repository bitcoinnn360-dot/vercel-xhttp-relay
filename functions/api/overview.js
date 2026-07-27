/**
 * Cloudflare Pages Function — live overview refresh
 * GET /api/overview
 *
 * Pulls fresh:
 *  - TGJU quotes (TEDPIX, USD)
 *  - TGJU today-table-data (intraday index path)
 *  - shakhesban indices (equal-weight, IFB)
 *  - SourceArena market_bourse + market_farabourse (official MV sum)
 *  - parsistahlil.ir latest retail / money-flow report
 *  - TradersArena /data/market for order-book + per-capita pulse
 */
import {
  fetchTradersArenaPulse,
  loadPulseStore,
  savePulseStore,
  mergePulseHistory,
} from '../lib/pulse.js'

const TGJU_AJAX = 'https://call2.tgju.org/ajax.json'
const TGJU_TODAY = 'https://api.tgju.org/v1/market/indicator/today-table-data/bourse?lang=fa'
const SHAKH_INDEX = 'https://www.shakhesban.com/markets/index'
const SHAKH_LIST = 'https://www.shakhesban.com/stocks/list-data'
const TA_HEATMAP_STOCK_FUNDS = 'https://tradersarena.ir/data/heatmap/stock-funds'
const TA_MARKET_VALUES = 'https://tradersarena.ir/data/market-values'
const PARSIS_HOME = 'https://parsistahlil.ir/'
const SOURCEARENA_API = 'https://apis.sourcearena.ir/api/'
const RAHAVARD_API = 'https://rahavard365.com/api/v2'
const TOP_TRADES_LIMIT = 12
const EQUITY_FUND_RAHAVARD_CANDIDATES = 28
/** Liquid equity ETFs often missing/zero on shakhesban QTotCap — always try Rahavard. */
const PRIORITY_EQUITY_FUNDS = [
  'اهرم',
  'شتاب',
  'آگاس',
  'موج',
  'جهش',
  'توان',
  'نارنج',
  'بیدار',
  'پالایش',
  'دارایکم',
  'اطلس',
  'سرو',
  'کاریس',
  'تمشک',
  'همای',
  'آساس',
  'پتروآگاه',
]
const BILLION_RIAL_PER_HEMAT = 10000
const RIAL_PER_HEMAT = 1e13
const RIAL_PER_BILLION_TOMAN = 1e10

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function parseNum(raw) {
  if (raw == null) return null
  const n = Number(String(raw).replace(/,/g, '').replace(/[^\d.eE+-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseBillionRial(raw) {
  if (raw == null) return null
  const s = String(raw).trim().replace(/,/g, '').replace(/\s/g, '').replace(/[Bb]$/, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toHmt(billionRial) {
  if (billionRial == null) return null
  return Math.round((billionRial / BILLION_RIAL_PER_HEMAT) * 10) / 10
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { Accept: '*/*', 'User-Agent': UA, Referer: 'https://www.tgju.org/' },
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.text()
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

async function fetchJsonRetry(url, attempts = 4) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': UA,
          Referer: 'https://sourcearena.ir/',
        },
      })
      if (!res.ok) throw new Error(`${url} ${res.status}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr
}

function tgjuQuote(row, id, name) {
  if (!row) return null
  const value = parseNum(row.p)
  const change = parseNum(row.d) ?? 0
  const changePct = parseNum(row.dp) ?? 0
  const signedChange = row.dt === 'low' || changePct < 0 ? -Math.abs(change) : Math.abs(change)
  return {
    id,
    name,
    value,
    change: signedChange,
    changePct: row.dt === 'low' ? -Math.abs(changePct) : Math.abs(changePct),
    time: row.t || row.t_en || null,
    source: 'tgju',
  }
}

function parseShakhesbanIndices(html) {
  const wanted = {
    'ش-کل-بورس': 'tedpix',
    'ش-کل-هم-وزن': 'equalWeight',
    'ش-کل-فرابورس': 'ifb',
  }
  const out = {}
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m
  while ((m = trRe.exec(html))) {
    const block = m[1]
    const hm = block.match(/\/markets\/index\/([^"']+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/)
    if (!hm) continue
    const slug = decodeURIComponent(hm[1])
    const key = wanted[slug]
    if (!key) continue
    const title = stripHtml(hm[2])
    const vals = {}
    const tdRe1 = /<td[^>]*data-val="([^"]*)"[^>]*data-col="([^"]+)"/g
    const tdRe2 = /<td[^>]*data-col="([^"]+)"[^>]*data-val="([^"]*)"/g
    let td
    while ((td = tdRe1.exec(block))) vals[td[2]] = td[1]
    while ((td = tdRe2.exec(block))) vals[td[1]] = td[2]
    const value = parseNum(vals.value || vals['info.last_trade.PDrCotVal'])
    const change = parseNum(vals.change || vals['info.last_trade.last_change'])
    let pct = parseNum(vals['info.last_trade.last_change_percentage'] || vals.percent)
    if (pct != null && Math.abs(pct) < 1) pct = pct * 100
    else if (pct == null && value != null && change != null && value !== change) {
      const prev = value - change
      if (prev) pct = (change / prev) * 100
    }
    out[key] = {
      name: title,
      value,
      change,
      changePct: pct != null ? Math.round(pct * 100) / 100 : null,
      source: 'shakhesban',
    }
  }
  return out
}

function parseIntraday(payload) {
  const rows = payload?.data || []
  const points = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue
    const value = parseNum(row[0])
    const time = String(row[1] || '').trim()
    if (value == null || !time) continue
    const chg = parseNum(stripHtml(row[2]))
    points.push({ time, value, change: chg })
  }
  points.reverse()
  return points
}

function jalaliToday() {
  const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
  const y = String(parts.year).padStart(4, '0')
  const mo = String(parts.month).padStart(2, '0')
  const d = String(parts.day).padStart(2, '0')
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return {
    dateJalali: `${y}/${mo}/${d}`,
    dateGregorian: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' }),
    time: timeFmt.format(new Date()),
  }
}

function parseShakhesbanTbody(tbody) {
  const rows = []
  const trRe = /<tr\s+data-symbol="([^"]+)">([\s\S]*?)<\/tr>/g
  let m
  while ((m = trRe.exec(tbody || ''))) {
    const symbol = m[1]
    const block = m[2]
    const vals = {}
    const tdRe1 = /<td[^>]*data-val="([^"]*)"[^>]*data-col="([^"]+)"/g
    const tdRe2 = /<td[^>]*data-col="([^"]+)"[^>]*data-val="([^"]*)"/g
    let td
    while ((td = tdRe1.exec(block))) vals[td[2]] = td[1]
    while ((td = tdRe2.exec(block))) vals[td[1]] = td[2]
    const marketFa = vals['info.market_fa'] || ''
    if (marketFa === 'آتی') continue
    const yesterday = parseNum(vals['info.PriceYesterday']) || 0
    const close = parseNum(vals['info.last_price.PClosing']) || 0
    const last = parseNum(vals['info.last_trade.PDrCotVal']) || 0
    let closeChg = parseNum(vals['info.last_price.closing_change'])
    let lastChg = parseNum(vals['info.last_trade.last_change'])
    if (closeChg == null && close && yesterday) closeChg = close - yesterday
    if (lastChg == null && last && yesterday) lastChg = last - yesterday
    const finalChg = closeChg != null && closeChg !== 0 ? closeChg : lastChg
    rows.push({
      symbol,
      title: vals['info.title'] || '',
      marketFa,
      flow: vals['info.flow.title'] || '',
      marketValue: parseNum(vals['trades.arzesh_bazar']) || 0,
      tradeValue: parseNum(vals['trades.QTotCap']) || 0,
      close,
      last,
      yesterday,
      closeChg,
      lastChg,
      finalChg,
      changePctLast: parseNum(vals['info.last_trade.last_change_percentage']) || 0,
      changePctClose: parseNum(vals['info.last_price.closing_change_percentage']) || 0,
      buyIVol: parseNum(vals['trades.buy_and_sell.Buy_I_Volume']) || 0,
      sellIVol: parseNum(vals['trades.buy_and_sell.Sell_I_Volume']) || 0,
      orderBuyVol: parseNum(vals['demands.1_0']) || 0,
      orderBuyCnt: parseNum(vals['demands.1_1']) || 0,
      orderBuyPx: parseNum(vals['demands.1_2']) || 0,
      orderSellPx: parseNum(vals['demands.1_3']) || 0,
      orderSellCnt: parseNum(vals['demands.1_4']) || 0,
      orderSellVol: parseNum(vals['demands.1_5']) || 0,
    })
  }
  return rows
}

async function scrapeShakhesbanPages({ maxPages = 12, orderCol = 'trades.arzesh_bazar', market = null } = {}) {
  const pages = Array.from({ length: maxPages }, (_, i) => i + 1)
  const results = await Promise.allSettled(
    pages.map(async (page) => {
      const qs = new URLSearchParams({
        limit: '100',
        page: String(page),
        order_col: orderCol,
        order_dir: 'desc',
        _: String(Date.now()),
      })
      if (market) qs.set('market', market)
      const res = await fetch(`${SHAKH_LIST}?${qs}`, {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'User-Agent': UA,
          Referer: 'https://www.shakhesban.com/',
          'X-Requested-With': 'XMLHttpRequest',
        },
      })
      if (!res.ok) throw new Error(`shakhesban ${page} ${res.status}`)
      return res.json()
    }),
  )
  const rows = []
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    rows.push(...parseShakhesbanTbody(r.value?.tbody || ''))
  }
  return rows
}

async function scrapeShakhesbanBoardLite(maxPages = 12) {
  // Full board (سهام+صندوق+اوراق) — no market=stock filter. Used for IFB impacts + fallback pulse.
  return scrapeShakhesbanPages({ maxPages, orderCol: 'trades.arzesh_bazar' })
}

/** Normalize Persian symbols for set membership (دارا یکم ↔ دارایکم). */
function normalizeSymbolKey(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/\u200c/g, '')
    .replace(/\u200d/g, '')
    .replace(/\u00a0/g, '')
    .trim()
}

/**
 * Equity-fund universe from TradersArena heatmap «صندوق های سهامی»
 * (includes اهرمی / بخشی / شاخصی / کلاسیک subclasses).
 */
async function fetchEquityFundSymbolSet() {
  const res = await fetch(TA_HEATMAP_STOCK_FUNDS, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': UA,
      Referer: 'https://tradersarena.ir/',
    },
  })
  if (!res.ok) throw new Error(`ta heatmap stock-funds ${res.status}`)
  const rows = await res.json()
  const set = new Set()
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const key = normalizeSymbolKey(row?.name)
      if (key) set.add(key)
    }
  }
  // shakhesban ticker spelling for دارا یکم
  set.add(normalizeSymbolKey('دارایکم'))
  set.add(normalizeSymbolKey('دارا یکم'))
  return set
}

function isEquityFundRow(row, fundSet) {
  if ((row?.marketFa || '') !== 'صندوق') return false
  const key = normalizeSymbolKey(row.symbol)
  if (fundSet && fundSet.size && fundSet.has(key)) return true
  const flow = row.flow || ''
  const title = row.title || row.name || ''
  if (flow.includes('بورس کالا')) return false
  if (/طلا|سکه|نقره|زعفران|درآمد\s*ثابت|املاک|مستغلات/.test(title)) return false
  if (/(سهامی|در سهام|اهرم|بخشی|شاخصی|مختلط)/.test(title)) return true
  return false
}

function isTopTradeCandidate(row, fundSet) {
  if (!row || !(row.tradeValue > 0)) return false
  const marketFa = row.marketFa || ''
  if (!marketFa || marketFa === 'سهام') return true
  return isEquityFundRow(row, fundSet)
}

function buildTopTradesFromBoard(rows, fundSet, limit = TOP_TRADES_LIMIT) {
  return (rows || [])
    .filter((s) => isTopTradeCandidate(s, fundSet))
    .sort((a, b) => (b.tradeValue || 0) - (a.tradeValue || 0))
    .slice(0, limit)
    .map((s) => ({
      name: s.symbol,
      valueBr: Math.round((s.tradeValue / RIAL_PER_BILLION_TOMAN) * 10) / 10,
    }))
}

/** TradersArena market-values: reliable stock trade value (`t`, rial). */
async function fetchTaMarketValueRows() {
  const res = await fetch(TA_MARKET_VALUES, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': UA,
      Referer: 'https://tradersarena.ir/',
    },
  })
  if (!res.ok) throw new Error(`ta market-values ${res.status}`)
  const rows = await res.json()
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => {
      const name = String(r?.s || '').trim()
      const tradeValue = Number(r?.t)
      if (!name || !Number.isFinite(tradeValue) || tradeValue <= 0) return null
      return {
        name,
        valueBr: Math.round((tradeValue / RIAL_PER_BILLION_TOMAN) * 10) / 10,
        kind: 'stock',
      }
    })
    .filter(Boolean)
}

async function fetchRahavardTradeValueBr(symbol) {
  const q = encodeURIComponent(symbol)
  const searchRes = await fetch(`${RAHAVARD_API}/search?keyword=${q}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': UA,
      Referer: 'https://rahavard365.com/',
    },
  })
  if (!searchRes.ok) throw new Error(`rahavard search ${searchRes.status}`)
  const search = await searchRes.json()
  const hit = (search?.data || []).find(
    (x) => String(x?.trade_symbol || '') === symbol && (x?.type === 'صندوق' || x?.type === 'سهام'),
  )
  if (!hit?.entity_id) return null
  const assetRes = await fetch(`${RAHAVARD_API}/asset/${hit.entity_id}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': UA,
      Referer: 'https://rahavard365.com/',
    },
  })
  if (!assetRes.ok) throw new Error(`rahavard asset ${assetRes.status}`)
  const asset = await assetRes.json()
  const value = parseNum(asset?.data?.last_trade?.value)
  if (value == null || value <= 0) return null
  return Math.round((value / RIAL_PER_BILLION_TOMAN) * 10) / 10
}

/**
 * Top 12 = سهام (TradersArena market-values.t) ∪ صندوق سهامی (Rahavard last_trade.value).
 * Shakhesban QTotCap is often wrong after close / for some names (e.g. فصبا).
 */
async function buildLiveTopTrades(fundSet) {
  const stockRows = await fetchTaMarketValueRows()

  // Prefer a small liquid ETF set — full board+Rahavard fan-out often times out on CF.
  const fundSymbols = []
  const seen = new Set()
  for (const sym of PRIORITY_EQUITY_FUNDS) {
    const key = normalizeSymbolKey(sym)
    if (seen.has(key)) continue
    if (fundSet?.size && !fundSet.has(key) && sym !== 'دارایکم' && key !== normalizeSymbolKey('دارا یکم')) {
      continue
    }
    fundSymbols.push(sym)
    seen.add(key)
  }

  const fundRows = []
  // modest concurrency to avoid Rahavard resets / worker subrequest storms
  const chunkSize = 4
  for (let i = 0; i < fundSymbols.length; i += chunkSize) {
    const chunk = fundSymbols.slice(i, i + chunkSize)
    const settled = await Promise.allSettled(
      chunk.map(async (symbol) => {
        const valueBr = await fetchRahavardTradeValueBr(symbol)
        if (valueBr == null) return null
        return { name: symbol, valueBr, kind: 'equity-fund' }
      }),
    )
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) fundRows.push(r.value)
    }
  }

  const merged = [...stockRows, ...fundRows]
    .filter((r) => (r.valueBr || 0) > 0)
    .sort((a, b) => b.valueBr - a.valueBr)

  const byName = new Map()
  for (const row of merged) {
    const prev = byName.get(row.name)
    if (!prev || row.valueBr > prev.valueBr) byName.set(row.name, row)
  }
  const top = [...byName.values()].sort((a, b) => b.valueBr - a.valueBr).slice(0, TOP_TRADES_LIMIT)
  return {
    topTrades: top.map(({ name, valueBr }) => ({ name, valueBr })),
    topTradesSource: fundRows.length
      ? 'tradersarena-market-values+rahavard-equity-funds'
      : stockRows.length
        ? 'tradersarena-market-values'
        : null,
    equityFundsEnriched: fundRows.length,
  }
}

/** Dedicated scrape ordered by trade value: سهام + صندوق (filtered later). */
function computeBoardImpacts(stocks, indices, maxMove = 0.22) {
  const equities = stocks.filter((s) => !s.marketFa || s.marketFa === 'سهام')
  const bourse = equities.filter((s) => !(s.flow || '').includes('فرابورس'))
  const ifb = equities.filter((s) => (s.flow || '').includes('فرابورس'))
  const indexB = indices?.tedpix?.value || 0
  const indexF = indices?.ifb?.value || 0
  const totalB = bourse.reduce((a, s) => a + (s.marketValue || 0), 0)
  const totalF = ifb.reduce((a, s) => a + (s.marketValue || 0), 0)

  const build = (rows, index, total) => {
    if (!index || !total) return { pos: [], neg: [] }
    const items = []
    for (const s of rows) {
      const mv = s.marketValue || 0
      const yest = s.yesterday || 0
      let chg = s.finalChg
      if (chg == null || chg === 0) chg = s.closeChg
      if (chg == null || chg === 0) chg = s.lastChg
      if (!mv || !yest || chg == null) continue
      const move = chg / yest
      if (Math.abs(move) > maxMove) continue
      items.push({ symbol: s.symbol, impact: Math.round(index * (mv / total) * move * 10) / 10 })
    }
    return {
      pos: items.filter((x) => x.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 5),
      neg: items.filter((x) => x.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, 5),
    }
  }

  const b = build(bourse, indexB, totalB)
  const f = build(ifb, indexF, totalF)
  return {
    boursePos: b.pos,
    bourseNeg: b.neg,
    ifbPos: f.pos,
    ifbNeg: f.neg,
    source: 'shakhesban-board',
  }
}

/** Fallback pulse from board best-level only (when TradersArena is unreachable). */
function buildMarketPulseFallback(stocks) {
  let pos = 0
  let neg = 0
  let flat = 0
  let orderBuy = 0
  let orderSell = 0
  let retailBuy = 0
  let retailSell = 0
  let buyCnt = 0
  let sellCnt = 0
  for (const s of stocks) {
    let p = s.changePctLast ?? s.changePctClose ?? 0
    if (Math.abs(p) < 1) p *= 100
    if (p > 0.05) pos += 1
    else if (p < -0.05) neg += 1
    else flat += 1
    orderBuy += (s.orderBuyVol || 0) * (s.orderBuyPx || 0)
    orderSell += (s.orderSellVol || 0) * (s.orderSellPx || 0)
    const px = s.last || s.close || 0
    retailBuy += (s.buyIVol || 0) * px
    retailSell += (s.sellIVol || 0) * px
    buyCnt += s.orderBuyCnt || 0
    sellCnt += s.orderSellCnt || 0
  }
  const today = jalaliToday()
  const perBuy = buyCnt > 0 ? retailBuy / buyCnt / RIAL_PER_BILLION_TOMAN : null
  const perSell = sellCnt > 0 ? retailSell / sellCnt / RIAL_PER_BILLION_TOMAN : null
  return {
    asOf: new Date().toISOString(),
    time: today.time,
    dateJalali: today.dateJalali,
    source: 'shakhesban-board-fallback',
    breadth: { positive: pos, negative: neg, flat, total: pos + neg + flat },
    orderBuyBillionToman: Math.round((orderBuy / RIAL_PER_BILLION_TOMAN) * 10) / 10,
    orderSellBillionToman: Math.round((orderSell / RIAL_PER_BILLION_TOMAN) * 10) / 10,
    retailMoneyFlowBillionToman: Math.round(((retailBuy - retailSell) / RIAL_PER_BILLION_TOMAN) * 10) / 10,
    retailBuyBillionToman: Math.round((retailBuy / RIAL_PER_BILLION_TOMAN) * 10) / 10,
    retailSellBillionToman: Math.round((retailSell / RIAL_PER_BILLION_TOMAN) * 10) / 10,
    perCapitaBuyMillionToman: perBuy != null ? Math.round(perBuy * 1000 * 100) / 100 : null,
    perCapitaSellMillionToman: perSell != null ? Math.round(perSell * 1000 * 100) / 100 : null,
    note: 'پشتیبان · بهترین سطح تابلو (بدون عمق ۵ خط)',
  }
}

async function scrapeRahavardImpacts() {
  const hdrs = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': UA,
    Referer: 'https://rahavard365.com/',
    Origin: 'https://rahavard365.com',
  }
  const load = async (kind) => {
    const res = await fetch(`${RAHAVARD_API}/home/${kind}-instrument-effect-d`, { headers: hdrs })
    if (!res.ok) throw new Error(`rahavard ${kind} ${res.status}`)
    const payload = await res.json()
    const list = payload?.data?.list || []
    return list
      .map((row) => {
        const symbol = String(row?.trade_symbol || row?.short_name || '').trim()
        const impact = parseNum(row?.instrument_effect_value)
        if (!symbol || impact == null) return null
        return { symbol, impact: Math.round(impact * 10) / 10 }
      })
      .filter(Boolean)
      .slice(0, 5)
  }
  try {
    const [pos, neg] = await Promise.all([load('positive'), load('negative')])
    return {
      ok: Boolean(pos.length || neg.length),
      source: 'rahavard365',
      boursePos: [...pos].sort((a, b) => b.impact - a.impact).slice(0, 5),
      bourseNeg: [...neg].sort((a, b) => a.impact - b.impact).slice(0, 5),
    }
  } catch (e) {
    return { ok: false, source: 'rahavard365', error: String(e), boursePos: [], bourseNeg: [] }
  }
}

async function scrapeSourceArena(token) {
  const tok = (token || '').trim()
  if (!tok) return { ok: false, error: 'SOURCEARENA_TOKEN missing' }

  // فقط «در یک نگاه» برای ارزش بازار — all/ind را کم صدا بزن تا سقف روزانه نخورد
  const [bourseRes, ifbRes] = await Promise.allSettled([
    fetchJsonRetry(`${SOURCEARENA_API}?token=${encodeURIComponent(tok)}&market=market_bourse`),
    fetchJsonRetry(`${SOURCEARENA_API}?token=${encodeURIComponent(tok)}&market=market_farabourse`),
  ])

  if (bourseRes.status !== 'fulfilled' || ifbRes.status !== 'fulfilled') {
    const err =
      (bourseRes.status === 'rejected' && String(bourseRes.reason)) ||
      (ifbRes.status === 'rejected' && String(ifbRes.reason)) ||
      'sourcearena failed'
    return { ok: false, error: err }
  }

  if (bourseRes.value?.Error) return { ok: false, error: String(bourseRes.value.Error) }
  if (ifbRes.value?.Error) return { ok: false, error: String(ifbRes.value.Error) }

  const bourse = bourseRes.value?.bourse
  const ifb = ifbRes.value?.['fara-bourse']
  if (!bourse || !ifb) return { ok: false, error: 'unexpected sourcearena payload' }

  const bMv = toHmt(parseBillionRial(bourse.market_value))
  const fMv = toHmt(parseBillionRial(ifb.market_value))
  const bTr = toHmt(parseBillionRial(bourse.trade_value))
  const fTr = toHmt(parseBillionRial(ifb.trade_value))
  if (bMv == null || fMv == null) return { ok: false, error: 'missing market_value' }

  let totalTrade = null
  let tradeSource = null
  if (bTr != null && fTr != null && fTr <= Math.max(bTr * 4, 80)) {
    totalTrade = Math.round((bTr + fTr) * 100) / 100
    tradeSource = 'sourcearena-bourse+ifb'
  } else if (bTr != null) {
    totalTrade = bTr
    tradeSource = 'sourcearena-bourse-only'
  }

  return {
    ok: true,
    source: 'sourcearena',
    bourseMarketValueHmt: bMv,
    ifbMarketValueHmt: fMv,
    totalMarketValueHmt: Math.round((bMv + fMv) * 10) / 10,
    totalTradeValueHmt: totalTrade,
    totalTradeValueSource: tradeSource,
    marketValueSource: 'sourcearena-bourse+ifb',
    impacts: null,
    impactsFromSourceArena: false,
    topTrades: [],
    topTradesSource: null,
    bourseRaw: bourse,
    ifbRaw: ifb,
  }
}

const SA_GLANCE_CACHE_URL = 'https://pulse-cache.internal/sourcearena-glance-v1'

async function loadSaGlanceCache(cache) {
  try {
    if (!cache) return null
    const hit = await cache.match(SA_GLANCE_CACHE_URL)
    if (!hit) return null
    const json = await hit.json()
    return json && typeof json === 'object' ? json : null
  } catch {
    return null
  }
}

async function saveSaGlanceCache(cache, glance, dateJalali) {
  if (!cache || !glance?.ok) return
  try {
    await cache.put(
      SA_GLANCE_CACHE_URL,
      new Response(
        JSON.stringify({
          ...glance,
          dateJalali: dateJalali || null,
          cachedAt: new Date().toISOString(),
        }),
        {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
        },
      ),
    )
  } catch {
    /* ignore */
  }
}

/** Board-derived MV/TV when SourceArena is rate-limited. */
function computeBoardMarketStats(stocks) {
  const equities = (stocks || []).filter((s) => !s.marketFa || s.marketFa === 'سهام')
  const bourse = equities.filter((s) => !(s.flow || '').includes('فرابورس'))
  const ifb = equities.filter((s) => (s.flow || '').includes('فرابورس'))
  const bMv = bourse.reduce((a, s) => a + (s.marketValue || 0), 0)
  const fMv = ifb.reduce((a, s) => a + (s.marketValue || 0), 0)
  const tradeAll = (stocks || []).reduce((a, s) => a + (s.tradeValue || 0), 0)
  if (bMv <= 0 && fMv <= 0) return null
  return {
    ok: true,
    bourseMarketValueHmt: Math.round((bMv / RIAL_PER_HEMAT) * 10) / 10,
    ifbMarketValueHmt: Math.round((fMv / RIAL_PER_HEMAT) * 10) / 10,
    totalMarketValueHmt: Math.round(((bMv + fMv) / RIAL_PER_HEMAT) * 10) / 10,
    totalTradeValueHmt: Math.round((tradeAll / RIAL_PER_HEMAT) * 100) / 100,
    marketValueSource: 'shakhesban-board',
    totalTradeValueSource: 'shakhesban-board',
  }
}

function isFreshMvSnapshot(snap, todayGregorian, todayJalali) {
  if (!snap || snap.totalMarketValueHmt == null) return false
  const asOf = snap.asOf || snap.cachedAt || snap.updatedAt
  if (asOf) {
    try {
      const g = new Date(asOf).toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' })
      return g === todayGregorian
    } catch {
      /* fall through */
    }
  }
  return Boolean(snap.dateJalali && snap.dateJalali === todayJalali)
}

function applyIndexMove(hmt, changePct) {
  if (hmt == null || !Number.isFinite(Number(hmt))) return null
  const pct = Number(changePct)
  if (!Number.isFinite(pct)) return Math.round(Number(hmt) * 10) / 10
  return Math.round(Number(hmt) * (1 + pct / 100) * 10) / 10
}

/**
 * Resolve MV + trade value with fallbacks:
 * SourceArena → today's CF cache → last SA/static adjusted by today's index move → board
 * Trade: prefer live TradersArena over stale snapshots
 */
function resolveMarketStats({
  sourcearena,
  boardStats,
  tradersPulse,
  saCache,
  staticLive,
  usd,
  todayJalali,
  todayGregorian,
  tedpixChangePct,
  ifbChangePct,
}) {
  let bourseMarketValueHmt = null
  let ifbMarketValueHmt = null
  let totalMarketValueHmt = null
  let totalTradeValueHmt = null
  let marketValueSource = null
  let totalTradeValueSource = null

  if (sourcearena?.ok && sourcearena.totalMarketValueHmt != null) {
    bourseMarketValueHmt = sourcearena.bourseMarketValueHmt
    ifbMarketValueHmt = sourcearena.ifbMarketValueHmt
    totalMarketValueHmt = sourcearena.totalMarketValueHmt
    marketValueSource = sourcearena.marketValueSource || 'sourcearena-bourse+ifb'
    if (sourcearena.totalTradeValueHmt != null) {
      totalTradeValueHmt = sourcearena.totalTradeValueHmt
      totalTradeValueSource = sourcearena.totalTradeValueSource || 'sourcearena'
    }
  } else {
    const baselines = [saCache, staticLive].filter((b) => b && b.totalMarketValueHmt != null)
    const sameDay = baselines.find((b) => isFreshMvSnapshot(b, todayGregorian, todayJalali))
    const baseline = sameDay || baselines[0] || null

    if (baseline) {
      const fromToday = isFreshMvSnapshot(baseline, todayGregorian, todayJalali)
      if (fromToday) {
        bourseMarketValueHmt = baseline.bourseMarketValueHmt ?? null
        ifbMarketValueHmt = baseline.ifbMarketValueHmt ?? null
        totalMarketValueHmt = baseline.totalMarketValueHmt
        marketValueSource = `${baseline.marketValueSource || 'sourcearena'}+cache`
      } else {
        // Snapshot is from a prior session — move with today's index % so KPI isn't frozen
        bourseMarketValueHmt = applyIndexMove(baseline.bourseMarketValueHmt, tedpixChangePct)
        ifbMarketValueHmt = applyIndexMove(baseline.ifbMarketValueHmt, ifbChangePct)
        if (bourseMarketValueHmt != null && ifbMarketValueHmt != null) {
          totalMarketValueHmt = Math.round((bourseMarketValueHmt + ifbMarketValueHmt) * 10) / 10
        } else {
          totalMarketValueHmt = applyIndexMove(baseline.totalMarketValueHmt, tedpixChangePct)
        }
        marketValueSource = `${baseline.marketValueSource || 'sourcearena'}+index-adjusted`
      }
      if (baseline.totalTradeValueHmt != null) {
        totalTradeValueHmt = baseline.totalTradeValueHmt
        totalTradeValueSource = `${baseline.totalTradeValueSource || 'sourcearena'}+${fromToday ? 'cache' : 'stale'}`
      }
    } else if (boardStats?.ok) {
      bourseMarketValueHmt = boardStats.bourseMarketValueHmt
      ifbMarketValueHmt = boardStats.ifbMarketValueHmt
      totalMarketValueHmt = boardStats.totalMarketValueHmt
      marketValueSource = boardStats.marketValueSource
    }
  }

  // Live trade value from TradersArena (same poll as pulse) when SA trade missing
  if (totalTradeValueHmt == null && tradersPulse?.totalTradeValueHmt != null) {
    totalTradeValueHmt = tradersPulse.totalTradeValueHmt
    totalTradeValueSource = 'tradersarena'
  } else if (totalTradeValueHmt == null && boardStats?.totalTradeValueHmt != null) {
    totalTradeValueHmt = boardStats.totalTradeValueHmt
    totalTradeValueSource = boardStats.totalTradeValueSource
  }

  // Prefer fresher TA trade over stale SA cache / deployed snapshot for "today"
  if (
    tradersPulse?.totalTradeValueHmt != null &&
    (totalTradeValueSource || '').match(/cache|deployed|static|stale/)
  ) {
    totalTradeValueHmt = tradersPulse.totalTradeValueHmt
    totalTradeValueSource = 'tradersarena'
  }

  let totalMarketValueUsdM = null
  if (totalMarketValueHmt != null && usd > 0) {
    totalMarketValueUsdM = Math.round((totalMarketValueHmt * RIAL_PER_HEMAT) / usd / 1e6)
  }

  return {
    bourseMarketValueHmt,
    ifbMarketValueHmt,
    totalMarketValueHmt,
    totalTradeValueHmt,
    totalMarketValueUsdM,
    marketValueSource,
    totalTradeValueSource,
  }
}

function mergeImpacts(rahavard, board, arena) {
  const out = { boursePos: [], bourseNeg: [], ifbPos: [], ifbNeg: [] }
  const sources = []
  if (rahavard?.ok) {
    out.boursePos = rahavard.boursePos || []
    out.bourseNeg = rahavard.bourseNeg || []
    sources.push('rahavard365')
  }
  if (arena?.impacts) {
    if (!out.boursePos.length) out.boursePos = arena.impacts.boursePos || []
    if (!out.bourseNeg.length) out.bourseNeg = arena.impacts.bourseNeg || []
    out.ifbPos = arena.impacts.ifbPos || []
    out.ifbNeg = arena.impacts.ifbNeg || []
    sources.push('sourcearena')
  }
  if (board) {
    if (!out.boursePos.length) out.boursePos = board.boursePos || []
    if (!out.bourseNeg.length) out.bourseNeg = board.bourseNeg || []
    if (!out.ifbPos.length) out.ifbPos = board.ifbPos || []
    if (!out.ifbNeg.length) out.ifbNeg = board.ifbNeg || []
    sources.push('shakhesban-board')
  }
  const has = Object.values(out).some((arr) => arr.length > 0)
  return { impacts: has ? out : null, source: sources.join('+') || null }
}

const JALALI_MONTHS = {
  فروردین: 1,
  اردیبهشت: 2,
  خرداد: 3,
  تیر: 4,
  مرداد: 5,
  شهریور: 6,
  مهر: 7,
  آبان: 8,
  آذر: 9,
  دی: 10,
  بهمن: 11,
  اسفند: 12,
}

function parseJalaliDate(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    return {
      dateJalali: `${String(y).padStart(4, '0')}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
      date: `${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
    }
  }
  m = s.match(
    /^(\d{1,2})\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*(\d{4})$/,
  )
  if (!m) return null
  const d = Number(m[1])
  const mo = JALALI_MONTHS[m[2]]
  const y = Number(m[3])
  return {
    dateJalali: `${String(y).padStart(4, '0')}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
    date: `${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
  }
}

function parseParsistahlilHtml(html, cid, url) {
  const text = stripHtml(html.replace(/<script[\s\S]*?<\/script>/g, ' '))
  let retail = null
  let m = text.match(/معاملات\s*#?خرد[\s\S]{0,80}?مبلغ\s*([\d,]+)\s*میلیارد/) || text.match(/مبلغ\s*([\d,]+)\s*میلیارد تومان بود/)
  if (m) retail = parseNum(m[1])

  let totalTrades = null
  m = text.match(/ارزش کل معاملات امروز بازار\s*([\d,]+)\s*میلیارد/)
  if (m) totalTrades = parseNum(m[1])

  let flow = null
  m = text.match(/مبلغ\s*([\d,]+)\s*میلیارد تومان\s*(ورود|خروج)\s*حقیقی/)
  if (m) {
    flow = parseNum(m[1])
    if (flow != null) flow = m[2] === 'خروج' ? -Math.abs(flow) : Math.abs(flow)
  }

  let dateJalaliRaw = null
  m = text.match(/مورخ\s*(\d{1,2}\s*[\u0600-\u06FF]+\s*\d{4}|\d{4}\/\d{2}\/\d{2})/)
  if (m) dateJalaliRaw = m[1].trim()
  const parsed = parseJalaliDate(dateJalaliRaw)
  if (retail == null && flow == null) return null
  return {
    ok: true,
    source: 'parsistahlil.ir',
    contentId: String(cid),
    url,
    dateJalaliRaw,
    dateJalali: parsed?.dateJalali || null,
    date: parsed?.date || null,
    retailTradeValueBillionToman: retail,
    totalTradeValueBillionToman: totalTrades,
    retailMoneyFlowDailyBillionToman: flow,
  }
}

async function scrapeParsistahlil() {
  const home = await fetchText(PARSIS_HOME)
  const ids = [...home.matchAll(/\/contents\/(\d+)-%DA%AF%D8%B2%D8%A7%D8%B1%D8%B4-%D9%88%D8%B6%D8%B9%DB%8C%D8%AA-%D8%A8%D8%A7%D8%B2%D8%A7%D8%B1/g)].map(
    (x) => x[1],
  )
  const uniq = [...new Set(ids)].sort((a, b) => Number(b) - Number(a))
  const slug =
    '%DA%AF%D8%B2%D8%A7%D8%B1%D8%B4-%D9%88%D8%B6%D8%B9%DB%8C%D8%AA-%D8%A8%D8%A7%D8%B2%D8%A7%D8%B1-%D8%A7%D8%B1%D8%B2%D8%B4-%D9%85%D8%B9%D8%A7%D9%85%D9%84%D8%A7%D8%AA-%D8%AE%D8%B1%D8%AF-%D9%88-%D9%88%D8%B1%D9%88%D8%AF-%D9%88-%D8%AE%D8%B1%D9%88%D8%AC-%D9%BE%D9%88%D9%84-%D8%AD%D9%82%DB%8C%D9%82%DB%8C'

  let lastErr = 'no report link'
  const days = []
  const seedIds = uniq.map(Number).filter((n) => Number.isFinite(n))
  const newest = seedIds.length ? Math.max(...seedIds) : 1180
  const probe = new Set(seedIds)
  for (let i = newest; i > newest - 10 && i > 0; i--) probe.add(i)
  const ordered = [...probe].sort((a, b) => b - a).slice(0, 12)

  for (const cidNum of ordered) {
    const cid = String(cidNum)
    const url = `https://parsistahlil.ir/contents/${cid}-${slug}`
    try {
      const html = await fetchText(url)
      const row = parseParsistahlilHtml(html, cid, url)
      if (row) days.push(row)
      else lastErr = `content ${cid} no numbers`
    } catch (e) {
      lastErr = String(e)
    }
  }
  if (!days.length) return { ok: false, error: lastErr, days: [] }
  days.sort((a, b) => String(b.dateJalali || '').localeCompare(String(a.dateJalali || '')))
  const latest = days[0]
  return {
    ok: true,
    source: 'parsistahlil.ir',
    contentId: latest.contentId,
    url: latest.url,
    dateJalali: latest.dateJalaliRaw || latest.dateJalali,
    retailTradeValueBillionToman: latest.retailTradeValueBillionToman,
    totalTradeValueBillionToman: latest.totalTradeValueBillionToman,
    retailMoneyFlowDailyBillionToman: latest.retailMoneyFlowDailyBillionToman,
    days,
  }
}

function recomputeMoneyFlowYtd(store) {
  const baseline = Number(store.baselineYtdBillionToman ?? -25271)
  const through = String(store.baselineThroughJalali || '1405/04/29')
  let extra = 0
  let asOf = through
  let asLabel = through.slice(5)
  for (const row of store.series || []) {
    const dj = String(row.dateJalali || '')
    if (!dj || dj <= through) continue
    extra += Number(row.value) || 0
    asOf = dj
    asLabel = row.date || dj.slice(5)
  }
  return {
    ...store,
    ytdBillionToman: Math.round(baseline + extra),
    asOfJalali: asOf,
    asOfLabel: asLabel,
    updatedAt: new Date().toISOString(),
    source: 'parsistahlil.ir',
  }
}

function mergeMoneyFlowStore(store, days) {
  const through = String(store.baselineThroughJalali || '1405/04/29')
  const series = [...(store.series || [])]
  const byDate = new Map(series.filter((r) => r.dateJalali).map((r) => [String(r.dateJalali), r]))
  const added = []
  const ordered = [...(days || [])]
    .filter((d) => d.dateJalali && d.retailMoneyFlowDailyBillionToman != null)
    .sort((a, b) => String(a.dateJalali).localeCompare(String(b.dateJalali)))

  for (const day of ordered) {
    const dj = String(day.dateJalali)
    if (dj <= through) continue
    const value = Math.round(Number(day.retailMoneyFlowDailyBillionToman))
    if (!Number.isFinite(value)) continue
    const point = {
      date: day.date || dj.slice(5),
      dateJalali: dj,
      value,
      contentId: String(day.contentId || ''),
    }
    if (byDate.has(dj)) {
      const prev = byDate.get(dj)
      if (Number(prev.value) !== value) {
        Object.assign(prev, point)
        added.push(`update:${dj}`)
      }
      continue
    }
    series.push(point)
    byDate.set(dj, point)
    added.push(dj)
  }
  series.sort((a, b) => String(a.dateJalali).localeCompare(String(b.dateJalali)))
  const next = recomputeMoneyFlowYtd({ ...store, series })
  return { store: next, added }
}

export async function onRequestGet(context) {
  const errors = []
  let quotes = {}
  let indices = {}
  let intraday = []
  let parsistahlil = { ok: false }
  let sourcearena = { ok: false }
  let moneyFlowStore = {
    baselineYtdBillionToman: -25271,
    baselineThroughJalali: '1405/04/29',
    ytdBillionToman: -25271,
    asOfJalali: '1405/04/29',
    series: [],
  }

  const token =
    context?.env?.SOURCEARENA_TOKEN ||
    'bba6d330a87bac533f18cc245d3baeaa'

  const origin = new URL(context.request.url).origin

  const tasks = await Promise.allSettled([
    fetchJson(TGJU_AJAX),
    fetchJson(TGJU_TODAY),
    fetchText(SHAKH_INDEX),
    scrapeParsistahlil(),
    scrapeSourceArena(token),
    fetchJson(`${origin}/data/money_flow_ytd.json`).catch(() => null),
    scrapeRahavardImpacts(),
    scrapeShakhesbanBoardLite(12),
    fetchJson(`${origin}/data/market_pulse.json`).catch(() => null),
    fetchJson(`${origin}/data/impacts_cache.json`).catch(() => null),
    fetchTradersArenaPulse(),
    fetchJson(`${origin}/data/market.json`).catch(() => null),
    fetchEquityFundSymbolSet(),
    // placeholder slot kept for Promise index stability — live top trades built below
    Promise.resolve(null),
  ])

  if (tasks[0].status === 'fulfilled') {
    const current = tasks[0].value.current || {}
    quotes = {
      bourse: tgjuQuote(current.bourse, 'bourse', 'شاخص کل بورس'),
      price_dollar_rl: tgjuQuote(current.price_dollar_rl, 'price_dollar_rl', 'دلار آزاد'),
    }
  } else errors.push(`tgju: ${tasks[0].reason}`)

  if (tasks[1].status === 'fulfilled') {
    intraday = parseIntraday(tasks[1].value)
  } else errors.push(`intraday: ${tasks[1].reason}`)

  if (tasks[2].status === 'fulfilled') {
    indices = parseShakhesbanIndices(tasks[2].value)
  } else errors.push(`shakhesban: ${tasks[2].reason}`)

  if (tasks[3].status === 'fulfilled') {
    parsistahlil = tasks[3].value
  } else {
    parsistahlil = { ok: false, error: String(tasks[3].reason) }
    errors.push(`parsistahlil: ${tasks[3].reason}`)
  }

  if (tasks[4].status === 'fulfilled') {
    sourcearena = tasks[4].value
    if (!sourcearena.ok) errors.push(`sourcearena: ${sourcearena.error}`)
  } else {
    sourcearena = { ok: false, error: String(tasks[4].reason) }
    errors.push(`sourcearena: ${tasks[4].reason}`)
  }

  if (tasks[5].status === 'fulfilled' && tasks[5].value) {
    moneyFlowStore = tasks[5].value
  } else if (tasks[5].status === 'rejected') {
    errors.push(`money_flow_ytd: ${tasks[5].reason}`)
  }

  let rahavard = { ok: false }
  if (tasks[6].status === 'fulfilled') {
    rahavard = tasks[6].value
    if (!rahavard.ok) errors.push(`rahavard: ${rahavard.error || 'empty'}`)
  } else {
    errors.push(`rahavard: ${tasks[6].reason}`)
  }

  let boardRows = []
  if (tasks[7].status === 'fulfilled') {
    boardRows = tasks[7].value || []
  } else {
    errors.push(`shakhesban-board: ${tasks[7].reason}`)
  }

  const pulseStoreStatic = tasks[8].status === 'fulfilled' ? tasks[8].value : null
  const impactsCache = tasks[9].status === 'fulfilled' ? tasks[9].value : null

  let tradersPulse = null
  if (tasks[10].status === 'fulfilled') {
    tradersPulse = tasks[10].value
  } else {
    errors.push(`tradersarena: ${tasks[10].reason}`)
  }

  const marketJson = tasks[11].status === 'fulfilled' ? tasks[11].value : null
  const staticLive = marketJson?.overviewLive || null

  let equityFundSet = new Set()
  if (tasks[12].status === 'fulfilled' && tasks[12].value) {
    equityFundSet = tasks[12].value
  } else if (tasks[12].status === 'rejected') {
    errors.push(`equity-funds: ${tasks[12].reason}`)
  }

  let topTrades = []
  let topTradesSource = null
  try {
    const liveTop = await buildLiveTopTrades(equityFundSet)
    topTrades = liveTop.topTrades || []
    topTradesSource = liveTop.topTradesSource
    if (liveTop.equityFundsEnriched === 0 && equityFundSet.size) {
      errors.push('top-trades-equity-funds: rahavard enrich empty')
    }
  } catch (e) {
    errors.push(`top-trades: ${e}`)
    // last-resort: board equities only (may be stale/wrong — better than empty)
    const fallbackRows = boardRows.filter((s) => (!s.marketFa || s.marketFa === 'سهام') && s.tradeValue > 0)
    topTrades = buildTopTradesFromBoard(fallbackRows, equityFundSet, TOP_TRADES_LIMIT)
    topTradesSource = topTrades.length ? 'shakhesban-board-fallback' : null
  }

  const boardImpacts = boardRows.length ? computeBoardImpacts(boardRows, indices) : null
  const mergedImpacts = mergeImpacts(rahavard, boardImpacts, sourcearena)
  // fill gaps from deployed cache
  if (mergedImpacts.impacts && impactsCache) {
    for (const k of ['boursePos', 'bourseNeg', 'ifbPos', 'ifbNeg']) {
      if (!mergedImpacts.impacts[k]?.length && impactsCache[k]?.length) {
        mergedImpacts.impacts[k] = impactsCache[k]
        mergedImpacts.source = `${mergedImpacts.source || ''}+cache`.replace(/^\+/, '')
      }
    }
  }

  const cache = typeof caches !== 'undefined' ? caches.default : null
  const today = jalaliToday()
  if (sourcearena?.ok) await saveSaGlanceCache(cache, sourcearena, today.dateJalali)
  const saCache = sourcearena?.ok ? null : await loadSaGlanceCache(cache)
  const boardStats = computeBoardMarketStats(boardRows)

  let pulseStore = await loadPulseStore(cache, pulseStoreStatic)
  const marketPulse =
    tradersPulse ||
    (boardRows.length ? buildMarketPulseFallback(boardRows) : null) ||
    pulseStore?.current ||
    null
  if (marketPulse) {
    pulseStore = mergePulseHistory(pulseStore, marketPulse)
    await savePulseStore(cache, pulseStore)
  }
  const marketPulseHistory = Array.isArray(pulseStore?.history) ? pulseStore.history : []

  // topTrades already resolved above via TradersArena market-values + Rahavard equity funds

  const merged = mergeMoneyFlowStore(moneyFlowStore, parsistahlil.days || [])
  moneyFlowStore = merged.store

  const usd = quotes.price_dollar_rl?.value ?? null
  const tedpix = indices.tedpix || (quotes.bourse
    ? {
        name: quotes.bourse.name,
        value: quotes.bourse.value,
        change: quotes.bourse.change,
        changePct: quotes.bourse.changePct,
        source: 'tgju',
      }
    : null)

  const marketStats = resolveMarketStats({
    sourcearena,
    boardStats,
    tradersPulse: marketPulse,
    saCache,
    staticLive,
    usd,
    todayJalali: today.dateJalali,
    todayGregorian: today.dateGregorian,
    tedpixChangePct: tedpix?.changePct,
    ifbChangePct: indices?.ifb?.changePct,
  })

  const blocked = [
    ...(sourcearena.ok ? [] : ['sourcearena']),
    ...(parsistahlil.ok ? [] : ['parsistahlil']),
    ...(rahavard.ok ? [] : ['rahavard365']),
  ]

  return Response.json(
    {
      ok: true,
      updatedAt: new Date().toISOString(),
      dateJalali: today.dateJalali,
      dateGregorian: today.dateGregorian,
      quotes,
      indices: {
        tedpix,
        equalWeight: indices.equalWeight || null,
        ifb: indices.ifb || null,
      },
      intraday: {
        source: 'tgju-today-table',
        note: 'مسیر روزانه TGJU (رزولوشن چنددقیقه‌ای).',
        points: intraday,
      },
      sourcearena,
      rahavard,
      bourseMarketValueHmt: marketStats.bourseMarketValueHmt,
      ifbMarketValueHmt: marketStats.ifbMarketValueHmt,
      totalMarketValueHmt: marketStats.totalMarketValueHmt,
      totalMarketValueUsdM: marketStats.totalMarketValueUsdM,
      marketValueSource: marketStats.marketValueSource,
      totalTradeValueHmt: marketStats.totalTradeValueHmt,
      totalTradeValueSource: marketStats.totalTradeValueSource,
      impacts: mergedImpacts.impacts,
      impactsFromSourceArena: Boolean(mergedImpacts.source?.includes('sourcearena')),
      impactsFromRahavard: Boolean(mergedImpacts.source?.includes('rahavard')),
      impactsSource: mergedImpacts.source,
      topTrades,
      topTradesSource,
      marketPulse,
      marketPulseHistory,
      parsistahlil,
      retailMoneyFlowYtd: moneyFlowStore.ytdBillionToman,
      retailMoneyFlowYtdSource: 'parsistahlil-cumulative',
      moneyFlowAsOfJalali: moneyFlowStore.asOfJalali,
      moneyFlowSeries: (moneyFlowStore.series || []).map((r) => ({
        date: r.date,
        dateJalali: r.dateJalali,
        value: r.value,
      })),
      moneyFlowAdded: merged.added,
      usdRate: usd,
      errors,
      blocked,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}
